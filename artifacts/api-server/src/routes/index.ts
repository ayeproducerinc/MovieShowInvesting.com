import { Router, type IRouter } from "express";
import healthRouter from "./health";
import siteRouter from "./site";

const router: IRouter = Router();

router.use(healthRouter);
router.use(siteRouter);

export default router;
