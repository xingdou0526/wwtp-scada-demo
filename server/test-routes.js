import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createApp } from "./app.js";
import { createAdvisor } from "./advisor.js";
import { createSimulation, LIMITS } from "./simulator.js";

function createTestServer(t) {
  const dir = mkdtempSync(join(tmpdir(), "wwtp-routes-test-"));
  const instance = createApp({
    managementFile: join(dir, "management.json"),
    operationsFile: join(dir, "operations.json"),
    adviceFile: join(dir, "advices.json"),
    autoStart: false,
    random: () => 0.5,
  });
  const server = instance.app.listen(0, "127.0.0.1");
  t.after(() => {
    instance.close();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return new Promise((resolve, reject) => {
    server.once("listening", () => {
      const { port } = server.address();
      resolve({ baseUrl: `http://127.0.0.1:${port}`, instance });
    });
    server.once("error", reject);
  });
}

test("DO 瞬时跳变持续标为可疑、输出排查建议并阻止调节，多故障保持高严重度优先", () => {
  const sim = createSimulation(LIMITS, { random: () => 0.5 });
  const advisor = createAdvisor(sim);
  const history = [];
  const measured = [];
  const step = () => {
    sim.tick();
    history.push({ ...sim.snapshot(), measuredDo: sim.state.measured.do });
    measured.push({ tick: sim.state.tick, do: sim.state.measured.do });
    advisor.evaluate(history, measured);
  };

  for (let i = 0; i < 20; i++) step();
  const baselineDo = sim.state.bio.do;

  sim.injectFault("doSpike", true);
  step();
  assert.ok(sim.state.measured.do > baselineDo + 1.0, "开启跳变后首 tick 应立即出现跳变尖峰");
  assert.equal(sim.state.measured.doQuality, "suspect");
  assert.equal(sim.state.measured.doFaultType, "spike");
  const inspect = advisor.activeAdvices.find((a) => a.kind === "inspect-sensor");
  assert.ok(inspect);
  assert.match(inspect.reasons[0].value, /瞬时跳变/);

  // 连续推进多个 tick，排查建议不会在下一秒被误撤销
  for (let i = 0; i < 5; i++) step();
  assert.equal(sim.state.measured.doQuality, "suspect");
  assert.equal(sim.state.measured.doFaultType, "spike");
  assert.equal(advisor.activeAdvices.find((a) => a.kind === "inspect-sensor")?.id, inspect.id);

  // 叠加卡死故障时保持 bad/stuck，不被低优先级的 spike 降级覆盖
  sim.injectFault("doStuck", true);
  for (let i = 0; i < 12; i++) {
    step();
    assert.equal(sim.state.measured.doQuality, "bad");
    assert.equal(sim.state.measured.doFaultType, "stuck");
  }

  // 全部解除后恢复正常，排查建议自动失效
  sim.injectFault("doStuck", false);
  sim.injectFault("doSpike", false);
  step();
  assert.equal(sim.state.measured.doQuality, "good");
  assert.equal(advisor.activeAdvices.find((a) => a.kind === "inspect-sensor"), undefined);
});

test("DO 目标已达上限但好氧区 DO 仍持续偏低时输出核查建议而非静默", () => {
  const sim = createSimulation(LIMITS, { random: () => 0.5 });
  const advisor = createAdvisor(sim);
  sim.state.bio.doSetpoint = LIMITS.doSetpointMax;
  sim.state.bio.do = 2.0;
  sim.state.measured.do = 2.0;
  advisor.evaluate([], Array.from({ length: 10 }, () => ({ do: 2.0 })));
  const capAdvice = advisor.activeAdvices.find((a) => a.kind === "inspect-setpoint-cap");
  assert.ok(capAdvice);
  assert.equal(capAdvice.action, null);
  assert.match(capAdvice.title, /上限/);
});

test("DO 瞬时偏低但未满 10 分钟均值窗口以及冷却期内应返回明确的监测状态说明", () => {
  const sim = createSimulation(LIMITS, { random: () => 0.5 });
  const advisor = createAdvisor(sim);
  // 瞬时 DO 跌破 -0.35，但近 10 分钟均值仍高于阈值 → 趋势确认中
  sim.state.measured.do = 1.1;
  const mixed = [...Array.from({ length: 8 }, () => ({ do: 2.0 })), { do: 1.3 }, { do: 1.1 }];
  const confirming = advisor.monitorStatus([], mixed);
  assert.equal(confirming.level, "warning");
  assert.match(confirming.title, /10 分钟趋势/);

  // 触发上调建议后主动忽略 → 提示冷却中及剩余仿真分钟
  const allLow = Array.from({ length: 10 }, () => ({ do: 1.1 }));
  advisor.evaluate([], allLow);
  const advice = advisor.activeAdvices.find((a) => a.kind === "raise");
  assert.ok(advice);
  assert.ok(advisor.ignore(advice.id).ok);
  const cooling = advisor.monitorStatus([], allLow);
  assert.equal(cooling.level, "warning");
  assert.match(cooling.title, /冷却中/);
});

test("HTTP 路由包含完整 CORS 头、防护空请求体、精简 state 负载且复位预热 120 tick", async (t) => {
  const { baseUrl, instance } = await createTestServer(t);

  for (const path of ["/api/admin", "/api/knowledge/KB-AER-001", "/api/state"]) {
    const res = await fetch(`${baseUrl}${path}`, { headers: { Origin: "http://example.com" } });
    assert.equal(res.status, 200, `${path} 应返回 200`);
    assert.equal(res.headers.get("access-control-allow-origin"), "*", `${path} 应包含 CORS 响应头`);
  }

  const stateRes = await fetch(`${baseUrl}/api/state`);
  const payload = await stateRes.json();
  assert.equal(payload.history.length, 120);
  assert.equal("advices" in payload, false, "/api/state 不再下发未使用的 advices 列表");
  assert.equal("operations" in payload, false, "/api/state 不再下发未使用的 operations 列表");

  // 空请求体返回 400 而非 500
  for (const path of ["/api/scenario", "/api/fault"]) {
    const res = await fetch(`${baseUrl}${path}`, { method: "POST" });
    assert.equal(res.status, 400, `${path} 空请求体应返回 400`);
  }

  // 通过路由注入 doSpike 时应同步推进一步并返回最新 snapshot，无需等待定时器
  const faultRes = await fetch(`${baseUrl}/api/fault`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "doSpike", enabled: true }),
  });
  assert.equal(faultRes.status, 200);
  const faultBody = await faultRes.json();
  assert.equal(faultBody.snapshot.state.measured.doQuality, "suspect");
  assert.equal(faultBody.snapshot.activeAdvices[0]?.kind, "inspect-sensor");

  // 复位后同样预热 120 tick 并在响应中直接返回最新 snapshot
  const resetRes = await fetch(`${baseUrl}/api/reset`, { method: "POST" });
  assert.equal(resetRes.status, 200);
  const resetBody = await resetRes.json();
  assert.equal(resetBody.snapshot.history.length, 120);
  assert.equal(resetBody.snapshot.state.fault.doSpike, false);
});

test("MBR 膜通量随进水流量联动变化，且演示节奏控制、快捷剧本、执行标记与效益对比均可用", async (t) => {
  const { baseUrl } = await createTestServer(t);

  // 1. 膜通量随暴雨/夜间水量联动
  await fetch(`${baseUrl}/api/scenario`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: "storm", enabled: true }),
  });
  const stormFf = await (await fetch(`${baseUrl}/api/sim/fast-forward`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ minutes: 15 }),
  })).json();
  const stormFlux = stormFf.snapshot.state.membrane.flux;
  assert.ok(stormFlux > 17, `暴雨时膜通量应明显抬升，当前 ${stormFlux}`);

  // 2. 暂停与恢复
  const pauseRes = await (await fetch(`${baseUrl}/api/sim/pause`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paused: true }),
  })).json();
  assert.equal(pauseRes.paused, true);
  assert.equal(pauseRes.snapshot.timing.paused, true);

  // 3. 快捷演示剧本 + 执行标记 + 快进触发自动复评
  const shockPreset = await (await fetch(`${baseUrl}/api/preset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preset: "shock" }),
  })).json();
  assert.equal(shockPreset.snapshot.activePreset, "shock");
  const raiseAdvice = shockPreset.snapshot.activeAdvices.find((a) => a.kind === "raise" && !a.blocked);
  assert.ok(raiseAdvice, "冲击剧本应直接就绪可执行的 DO 上调建议");

  const execRes = await (await fetch(`${baseUrl}/api/advice/${raiseAdvice.id}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operatorNote: "演示确认" }),
  })).json();
  assert.equal(execRes.ok, true);

  const afterExec = await (await fetch(`${baseUrl}/api/sim/fast-forward`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ minutes: 30 }),
  })).json();
  assert.equal(afterExec.snapshot.markers.length, 1);
  assert.equal(afterExec.snapshot.markers[0].to, raiseAdvice.action.to);
  const ops = await (await fetch(`${baseUrl}/api/operations`)).json();
  assert.ok(ops.operations[0].after, "快进 30 仿真分钟后应自动完成复评");

  // 4. 夜间节能与异常防误调剧本
  const nightPreset = await (await fetch(`${baseUrl}/api/preset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preset: "night" }),
  })).json();
  assert.ok(nightPreset.snapshot.activeAdvices.some((a) => a.kind === "lower" && !a.blocked));

  const faultPreset = await (await fetch(`${baseUrl}/api/preset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preset: "fault" }),
  })).json();
  assert.ok(faultPreset.snapshot.activeAdvices.length >= 2, "异常剧本应并发多条排查建议");
  assert.ok(faultPreset.snapshot.activeAdvices.some((a) => a.kind === "inspect-sensor"));
  assert.ok(faultPreset.snapshot.activeAdvices.some((a) => a.kind === "inspect-airflow"));
  assert.ok(faultPreset.snapshot.activeAdvices.every((a) => a.type !== "adjust"), "仪表异常期间不应存在调节建议");

  // 5. 同随机种子效益对比接口
  const compare = await (await fetch(`${baseUrl}/api/compare`)).json();
  assert.equal(compare.scenarios.length, 2);
  const nightCmp = compare.scenarios.find((s) => s.key === "night");
  assert.ok(nightCmp.delta.kwh < 0, "夜间低负荷场景 AI 辅助应实现节能");
});

test("配置 staticDir 时可托管前端静态页并保持 /api 404 隔离", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "wwtp-static-test-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>WWTP</title>");
  const instance = createApp({
    managementFile: join(dir, "management.json"),
    operationsFile: join(dir, "operations.json"),
    adviceFile: join(dir, "advices.json"),
    staticDir: dir,
    autoStart: false,
  });
  const server = instance.app.listen(0, "127.0.0.1");
  t.after(() => {
    instance.close();
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await new Promise((res, rej) => {
    server.once("listening", res);
    server.once("error", rej);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const home = await fetch(`${baseUrl}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /<title>WWTP<\/title>/);

  const missingApi = await fetch(`${baseUrl}/api/not-found`);
  assert.equal(missingApi.status, 404);
});
