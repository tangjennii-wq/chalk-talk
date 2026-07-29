// WORKER ENTRY — the only file that imports Cloudflare-specific modules.
//
// WHY IT EXISTS. Workflows require the class to be exported from the deployed script, and it must extend
// `WorkflowEntrypoint` from `cloudflare:workers`. That import cannot resolve in Node, so putting the
// class in worker.js would have broken every suite that does `import worker from "./worker.js"` — and
// would have made the workflow testable only by deploying.
//
// So the split is: this file is a thin, boring shim with no logic worth testing, worker.js keeps the
// request handling, and generation_workflow.js holds the step logic with no platform imports at all.
// wrangler.toml's `main` points here.
import { WorkflowEntrypoint } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import worker from "./worker.js";
import { makeWorkflowDeps } from "./worker.js";
import { runGenerationWorkflow } from "./generation_workflow.js";

export class ChalkTalkGeneration extends WorkflowEntrypoint {
  async run(event, step) {
    // Bindings come from `this.env` inside a WorkflowEntrypoint — there is no third argument to run().
    // Everything platform-shaped is injected, so generation_workflow.js stays executable under Node.
    const deps = makeWorkflowDeps(this.env, { NonRetryableError });
    return await runGenerationWorkflow({ step, payload: event.payload, deps });
  }
}

export default worker;
