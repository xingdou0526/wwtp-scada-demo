import express from "express";

export function managementRoutes(store, sim, advisor) {
  const router = express.Router();
  router.use(express.json({ limit: "160kb" }));

  router.get("/", (_req, res) => res.json(store.data));

  router.post("/knowledge", (req, res) => res.status(201).json(store.createKnowledge(req.body)));
  router.put("/knowledge/:id", (req, res) => res.json(store.updateKnowledge(req.params.id, req.body)));
  router.delete("/knowledge/:id", (req, res) => {
    store.deleteKnowledge(req.params.id);
    res.json({ ok: true });
  });

  router.post("/terms", (req, res) => res.status(201).json(store.createTerm(req.body)));
  router.put("/terms/:id", (req, res) => res.json(store.updateTerm(req.params.id, req.body)));
  router.delete("/terms/:id", (req, res) => {
    store.deleteTerm(req.params.id);
    res.json({ ok: true });
  });

  router.put("/limits", (req, res) => {
    const previous = store.data.limits;
    const limits = store.updateLimits(req.body, sim.state.bio.doSetpoint);
    if (limits !== previous) {
      sim.configureLimits(limits);
      advisor.invalidatePending();
    }
    res.json(limits);
  });

  return router;
}
