import { Router, type IRouter } from "express";
import gameRouter from "./game";
import healthRouter from "./health";

const router: IRouter = Router();

router.use(healthRouter);
router.use(gameRouter);

export default router;
