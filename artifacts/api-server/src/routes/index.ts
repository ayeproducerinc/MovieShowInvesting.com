import { Router, type IRouter } from "express";
import healthRouter from "./health";
import siteRouter from "./site";
import progressRouter from "./progress";
import adminRouter from "./admin";
import filmmakerRouter from "./filmmaker";
import filmmakerAccountsRouter from "./filmmaker-accounts";
import filmmakerMediaRouter from "./filmmaker-media";
import locationsRouter from "./locations";
import projectsRouter from "./projects";

const router: IRouter = Router();

router.use(healthRouter);
router.use(siteRouter);
router.use(progressRouter);
router.use(adminRouter);
router.use(filmmakerRouter);
router.use(filmmakerAccountsRouter);
router.use(filmmakerMediaRouter);
router.use(locationsRouter);
router.use(projectsRouter);

export default router;
