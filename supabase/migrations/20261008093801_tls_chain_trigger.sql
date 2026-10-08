-- D-029: a misconfigured certificate chain (UNABLE_TO_VERIFY_LEAF_SIGNATURE and kin) is a PROBLEM
-- with its own trigger, never a DOWN — browsers still open the site, apps and API clients don't.
-- The check stays outcome 'fail' with the code in check_results.error; the engine tells it apart
-- (isHardFail). Only the trigger enum grows; the engine_* functions special-case 'hard_fail' only.
-- packages/shared TRIGGERS mirrors this enum.

alter type public.incident_trigger add value if not exists 'tls_chain';
