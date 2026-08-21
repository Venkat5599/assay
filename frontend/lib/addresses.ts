import {ACTIVE} from "./networks";

/**
 * Contract addresses for the deployment currently in force.
 *
 * Shape is unchanged from when these came straight out of environment
 * variables, so nothing downstream had to learn about networks - the source of
 * truth moved, the interface did not.
 */
export const addresses = ACTIVE.addresses;

/**
 * The UI renders fully before contracts exist. Deployment turns the controls
 * live; it never decides whether content is visible.
 */
export const isDeployed = Boolean(
  addresses.assetRegistry && addresses.market && addresses.vault && addresses.stable,
);
