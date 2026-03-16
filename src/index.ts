import express from "express";
import cors from "cors";
import rolesRouter from "./routes/roles";
import staffRouter from "./routes/staff";
import eventsRouter from "./routes/events";
import assignmentsRouter from "./routes/assignments";
import designazioniRouter from "./routes/designazioni";
import standardRequirementsRouter from "./routes/standardRequirements";

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: true })); // Allow localhost and common dev origins
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/roles", rolesRouter);
app.use("/api/staff", staffRouter);
app.use("/api/events", eventsRouter);
app.use("/api/assignments", assignmentsRouter);
app.use("/api/designazioni", designazioniRouter);
app.use("/api/standard-requirements", standardRequirementsRouter);

app.listen(PORT, () => {
  console.log(`PITCH_2 backend running on http://localhost:${PORT}`);
});
