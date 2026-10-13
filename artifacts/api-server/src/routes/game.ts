import { Router, type IRouter } from "express";
import { GetGameStatusResponse } from "@workspace/api-zod";
import { getGameStatus } from "../game/status";

const router: IRouter = Router();

router.get("/game/status", (_req, res) => {
  res.json(GetGameStatusResponse.parse(getGameStatus()));
});

export default router;
