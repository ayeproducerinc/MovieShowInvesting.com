import { Router, type IRouter } from "express";
import healthRouter from "./health";
import siteRouter from "./site";
import progressRouter from "./progress";
import adminRouter from "./admin";
import filmmakerRouter from "./filmmaker";
import filmmakerAccountsRouter from "./filmmaker-accounts";
import filmmakerMediaRouter from "./filmmaker-media";
import filmmakerPhoneRouter from "./filmmaker-phone";
import locationsRouter from "./locations";
import projectsRouter from "./projects";
import questionsRouter from "./questions";

const router: IRouter = Router();

router.use(healthRouter);
router.use(siteRouter);
router.use(progressRouter);
router.use(adminRouter);
router.use(filmmakerRouter);
router.use(filmmakerAccountsRouter);
router.use(filmmakerMediaRouter);
router.use(filmmakerPhoneRouter);
router.use(locationsRouter);
router.use(projectsRouter);
router.use(questionsRouter);

export default router;
