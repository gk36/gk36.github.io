import { Dumbbell, ExternalLink } from '../ui/icons';

/** Training lives in the existing workout page until the session logger milestone lands. */
export function Train() {
  return (
    <div class="page">
      <h1 class="page-title">Train</h1>
      <section class="card stack">
        <div class="cluster"><Dumbbell size={22} aria-hidden="true" /><h2 class="section-title">Your program</h2></div>
        <p class="muted">Your split, supersets, muscle tags, JSON/AI editing and the 3D exercise viewer are in the workout page — unchanged and working. Session logging (sets, loads, RIR, PRs) will be built into this tab.</p>
        <a class="btn btn-primary" href="../workout.html"><ExternalLink size={16} aria-hidden="true" /> Open workout program</a>
      </section>
    </div>
  );
}
