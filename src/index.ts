import "dotenv/config";
import { validateSupabaseConfig } from "./config/supabase";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import rolesRouter from "./routes/roles";
import staffRouter from "./routes/staff";
import staffSearchRouter from "./routes/staffRoutes";
import eventsRouter from "./routes/eventsRoutes";
import assignmentsRouter from "./routes/assignments";
import designazioniRouter from "./routes/designazioni";
import authRouter from "./routes/auth";
import magicLinksRouter from "./routes/magicLinks";
import standardRequirementsRouter from "./routes/standardRequirements";
import cookiesJarTasksRouter from "./routes/cookiesJarTasks";
import documentsRouter from "./routes/documents";
import agentRouter from "./routes/agent";
import auditLogRouter from "./routes/auditLogRoutes";
import staffPagePermissionsRouter from "./routes/staffPagePermissions";
import mePermissionsRouter from "./routes/mePermissions";
import myAssignmentsRouter from "./routes/myAssignmentsRoutes";
import devRouter from "./routes/devRoutes";
import consuntivoRouter from "./routes/consuntivoRoutes";
import accreditiRouter from "./routes/accreditiRoutes";
import accreditiExportRouter from "./routes/accreditiExportRoutes";
import accreditiPdfRouter from "./routes/accreditiPdfRoutes";
import accreditiXlsxRouter from "./routes/accreditiXlsxRoutes";
import accreditationAreasRouter from "./routes/accreditationAreasRoutes";
import productionContactsLeedsRouter from "./routes/productionContactsLeeds";
import standardCostRouter from "./routes/standardCost";

validateSupabaseConfig();

const app = express();
const PORT = process.env.PORT || 4000;

/** Frontend Next.js: cookie cross-site richiedono origin esplicito + credentials. */
const CORS_ORIGIN =
  process.env.CORS_ORIGIN?.trim() || "https://apppitch.it";
app.use(
  cors({
    origin: CORS_ORIGIN,
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/roles", rolesRouter);
app.use("/api/staff", staffRouter);
app.use("/api/staff", staffSearchRouter);
app.use("/api/events", eventsRouter);
app.use("/api/assignments", assignmentsRouter);
app.use("/api/designazioni", designazioniRouter);
app.use("/api/auth", authRouter);
app.use("/api/my-assignments", myAssignmentsRouter);
app.use("/api/magic-links", magicLinksRouter);
app.use("/api/standard-requirements", standardRequirementsRouter);
app.use("/api/standard-cost", standardCostRouter);
app.use("/api/cookies-jar/tasks", cookiesJarTasksRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/agent", agentRouter);
app.use("/api/audit-log", auditLogRouter);
app.use("/api/staff-page-permissions", staffPagePermissionsRouter);
app.use("/api/me/permissions", mePermissionsRouter);
app.use("/api/consuntivo", consuntivoRouter);
app.use("/api/accrediti", accreditiRouter);
app.use("/api/accrediti", accreditiExportRouter);
app.use("/api/accrediti", accreditiPdfRouter);
app.use("/api/accrediti", accreditiXlsxRouter);
app.use("/api/accreditation-areas", accreditationAreasRouter);
app.use("/api/production-contacts-leeds", productionContactsLeedsRouter);
/** SOLO SVILUPPO: magic link di test — vedi src/routes/devRoutes.ts */
app.use("/api/dev", devRouter);

app.listen(PORT, () => {
  console.log(`PITCH_2 backend running on http://localhost:${PORT}`);
});
