import { Router } from "express";
import {
  createAccount,
  deleteAccount,
  getAccounts,
  updateAccount
} from "./account.controller";

const accountRoutes = Router();

accountRoutes.get("/", getAccounts);
accountRoutes.post("/", createAccount);
accountRoutes.put("/:id", updateAccount);
accountRoutes.delete("/:id", deleteAccount);

export default accountRoutes;
