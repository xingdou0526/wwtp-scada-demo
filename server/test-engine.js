// 引擎验证脚本：独立驱动 tick，不依赖实时服务
import { createSimulation } from "./simulator.js";
import { createAdvisor } from "./advisor.js";

const sim = createSimulation(undefined, { random: () => 0.5 });
const advisor = createAdvisor(sim);
const history = [];
const measuredHistory = [];
let pass = 0, fail = 0;

function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`PASS ${name} ${extra}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

function run(n) {
  for (let i = 0; i < n; i++) {
    sim.tick();
    history.push({ ...sim.snapshot(), measuredDo: sim.state.measured.do });
    measuredHistory.push({ tick: sim.state.tick, do: sim.state.measured.do });
    advisor.evaluate(history, measuredHistory);
    advisor.reviewOperations();
  }
}

function pending() {
  return advisor.advices.find((a) => a.status === "pending");
}

// 1. 正常工况稳态（充分预热）
run(300);
check("稳态 DO 接近目标 2.0", Math.abs(sim.state.bio.do - 2.0) < 0.5, `do=${sim.state.bio.do.toFixed(2)}`);
check("稳态出水氨氮达标", sim.state.effluent.nh4 < 1.0, `nh4=${sim.state.effluent.nh4.toFixed(2)}`);
check("稳态无强制调节建议", !pending() || pending().type !== "adjust");
console.log("  当前建议:", pending() ? `${pending().type} ${pending().title}` : "无");

// 2. 进水冲击 → DO 下降 → 产生提高曝气建议（在建议出现时立即捕获）
sim.setScenario("shock", true);
let a1 = null;
let doMin = 99;
for (let i = 0; i < 100; i++) {
  run(1);
  doMin = Math.min(doMin, sim.state.bio.do);
  const p = pending();
  if (p && p.type === "adjust" && p.action && p.action.to > p.action.from) { a1 = p; break; }
}
check("冲击后 DO 出现明显下降", doMin < 1.8, `doMin=${doMin.toFixed(2)}`);
check("产生 R1 提高曝气建议", !!a1,
  a1 ? `${a1.title} ${a1.action.from}→${a1.action.to}` : "无建议");

// 3. 人工执行建议
if (a1) {
  const r = advisor.execute(a1.id, "测试执行");
  check("执行成功", r.ok, r.ok ? `doSetpoint=${sim.state.bio.doSetpoint}` : r.error);
  check("操作记录已生成", advisor.operations.length === 1);
  check("操作记录含操作前快照", !!advisor.operations[0]?.before);
  const r2 = advisor.execute(a1.id);
  check("重复执行被拦截", !r2.ok, r2.error);
} else {
  check("执行用例前置失败", false);
}

// 4. 间隔约束：执行后短时间内的新建议应 blocked 且执行被拦截
run(8);
const a2 = pending();
if (a2 && a2.type === "adjust") {
  check("间隔不足的建议被标记 blocked", a2.blocked === true);
  const r3 = advisor.execute(a2.id);
  check("间隔不足执行被拦截", !r3.ok, r3.error);
} else {
  console.log("  (执行后短时间内无新调节建议，跳过间隔用例)");
}

// 5. 执行后 DO 回升 + 复评回填
run(100);
check("执行后 DO 回升", sim.state.bio.do > doMin + 0.4 && sim.state.bio.do > 1.5,
  `do=${sim.state.bio.do.toFixed(2)}（最低 ${doMin.toFixed(2)}）`);
check("操作后快照已回填", !!advisor.operations[0]?.after,
  advisor.operations[0]?.after ? `after.do=${advisor.operations[0].after.do.toFixed(2)}` : "未回填");

// 6. 数据卡死 → 仅排查建议，不出调节建议
advisor.advices.forEach((a) => { if (a.status === "pending") a.status = "ignored"; });
sim.injectFault("doStuck", true);
run(5);
const a3 = pending();
check("DO 卡死时输出排查类建议", !!a3 && a3.type === "inspect", a3 ? a3.title : "无建议");
if (a3) {
  const r4 = advisor.execute(a3.id);
  check("排查类建议不可执行调节", !r4.ok, r4.error);
}
sim.injectFault("doStuck", false);

// 7. 复位
sim.reset();
check("复位后 DO 目标恢复 2.0", sim.state.bio.doSetpoint === 2.0);
check("复位后场景清空", !sim.state.scenario.shock && !sim.state.fault.doStuck);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
