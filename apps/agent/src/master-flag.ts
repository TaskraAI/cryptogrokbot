import { getFlag, setFlag, type Store } from "@night/storage";

/**
 * Boot policy for the SQLite `master` kill switch.
 * `MASTER_ENABLED=false` in env always kills (fail-closed).
 * `MASTER_ENABLED=true` only seeds sqlite when the flag is missing, so a
 * dashboard or Telegram `/kill` survives restart even if `.env` still says true.
 */
export function applyMasterBootPolicy(store: Store, envMasterEnabled: boolean): void {
  if (!envMasterEnabled) {
    setFlag(store, "master", "false");
    return;
  }
  if (getFlag(store, "master") === "") {
    setFlag(store, "master", "true");
  }
}
