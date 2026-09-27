import { Router, type IRouter } from "express";
import healthRouter from "./health";
import siteRouter from "./site";
import progressRouter from "./progress";
import adminRouter from "./admin";
import filmmakerRouter from "./filmmaker";
import locationsRouter from "./locations";

const router: IRouter = Router();

router.use(healthRouter);
router.use(siteRouter);
router.use(progressRouter);
router.use(adminRouter);
router.use(filmmakerRouter);
router.use(locationsRouter);

export default router;
