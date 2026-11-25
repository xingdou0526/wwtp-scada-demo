import express from "express";

export function managementRoutes(store, sim, advisor, onChanged = () => {}) {
  const router = express.Router();
  router.use(express.json({ limit: "160kb" }));

  router.get("/", (_req, res) => res.json(store.data));

  router.post("/knowledge", (req, res) => {
    const entry = store.createKnowledge(req.body);
    onChanged();
    res.status(201).json(entry);
  });
  router.put("/knowledge/:id", (req, res) => {
    const entry = store.updateKnowledge(req.params.id, req.body);
    onChanged();
    res.json(entry);
  });
  router.delete("/knowledge/:id", (req, res) => {
    store.deleteKnowledge(req.params.id);
    onChanged();
    res.json({ ok: true });
  });

  router.post("/terms", (req, res) => {
    const entry = store.createTerm(req.body);
    onChanged();
    res.status(201).json(entry);
  });
  router.put("/terms/:id", (req, res) => {
    const entry = store.updateTerm(req.params.id, req.body);
    onChanged();
    res.json(entry);
  });
  router.delete("/terms/:id", (req, res) => {
    store.deleteTerm(req.params.id);
    onChanged();
    res.json({ ok: true });
  });

  router.put("/limits", (req, res) => {
    const previous = store.data.limits;
    const limits = store.updateLimits(req.body, sim.state.bio.doSetpoint);
    if (limits !== previous) {
      sim.configureLimits(limits);
      advisor.invalidatePending();
      onChanged();
    }
    res.json(limits);
  });

  return router;
}
