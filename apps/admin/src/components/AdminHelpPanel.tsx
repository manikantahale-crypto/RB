/**
 * Plain-language guide for non-technical admins (no table names in the main flow).
 */
export function AdminHelpPanel() {
  return (
    <details className="admin-help-panel">
      <summary>How policies and workflows are saved</summary>
      <div className="admin-help-body">
        <section>
          <h4>What is a policy?</h4>
          <p>
            The text box describes what this agent should do — in everyday language
            (e.g. process resumes, match with score 80). You can change it any time;
            each save creates a new <strong>version</strong> for this agent only.
          </p>
        </section>
        <section>
          <h4>Existing agents (SYNTRA, Intake, Copilot)</h4>
          <p>
            Their first policy was set when the product was installed. You see that
            text when you open the agent. When you edit and save, your new text
            replaces the draft for <em>this agent</em> — the original product agent
            is unchanged unless you edit that one directly.
          </p>
        </section>
        <section>
          <h4>New agents (e.g. SonuZ)</h4>
          <p>
            When you create an agent, we copy the policy from the agent you cloned
            from. You then edit the description for the new agent and save.
          </p>
        </section>
        <section>
          <h4>Create workflow</h4>
          <p>
            Your description is read by the AI assistant on the server. It picks
            steps (process job, process resume, match, or human review) and
            settings (threshold, filters). You review the preview, then Accept & save.
            Nothing is stored until you accept — preview is safe to try.
          </p>
        </section>
        <section>
          <h4>Make live</h4>
          <p>
            After safety checks, the workflow is linked to the <strong>trigger</strong>
            you chose (e.g. when a resume arrives). Only then do uploads and real
            events run this agent&apos;s steps.
          </p>
        </section>
        <section>
          <h4>Product agents vs custom agents</h4>
          <p>
            <strong>SYNTRA (matching)</strong> is the product agent for candidate
            matching when a job description or resume is uploaded.{" "}
            <strong>ASTRA, ORBIT, HELIX, TEMPO, PRISM, TAYLN</strong> are upcoming
            product agents — they appear in the list like SYNTRA until their dedicated
            tools ship. <strong>Custom agents</strong> (e.g. SonuZ) are copies you
            create to try a different policy without changing the product defaults.
          </p>
        </section>
        <section>
          <h4>Sidebar badges</h4>
          <ul>
            <li>
              <strong>New</strong> — no policy saved yet for this agent.
            </li>
            <li>
              <strong>Draft</strong> — policy saved; workflow not built yet.
            </li>
            <li>
              <strong>Ready to go live</strong> — workflow saved; uploads still use
              the old setup until you make live.
            </li>
            <li>
              <strong>Not connected</strong> — you marked this as live, but it is not
              linked to a trigger yet (uploads won&apos;t use it).
            </li>
            <li>
              <strong>Live</strong> — linked to a trigger; uploads and events that
              match that trigger run this workflow.
            </li>
          </ul>
        </section>
      </div>
    </details>
  );
}
