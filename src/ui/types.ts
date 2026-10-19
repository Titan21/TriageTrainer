// Shapes of the engine's runtime objects, as far as the UI needs them.
// The engine (src/game/session.js) is plain JS, so these are declared here.

export type Pos = [number, number];

export interface Category { id: string; label: string; priority: number; colour: string }

export interface Rules {
  approved: boolean;
  notice?: string;
  categories: Category[];
  scoring: { targetSecondsPerCasualty: number };
}

export interface Action {
  id: string;
  label: string;
  group: string;
  timeCostSeconds: number;
  effect: { type: string; [k: string]: unknown };
}

export interface CasualtyDef {
  id: string;
  title: string;
  ageGroup: string;
  approach: string;
  identity?: { name?: string | null; age?: number; sex?: string };
  teaching?: string[];
}

export interface Stage { def: { id: string; note?: string }; status: 'pending' | 'applied' | 'prevented'; appliedAt: number | null }

export interface Runtime {
  id: string;
  def: CasualtyDef;
  position: Pos;
  tag: { category: string; t: number } | null;
  visitedAt: number | null;
  observedName?: boolean;
  stages: Stage[];
}

export interface Message { t: number; text: string; urgent?: boolean; event?: string; type?: string; casualty?: string }
export interface Hazard { id: string; type: string; position: Pos; active: boolean }
export interface Bystander { id: string; description: string; position?: Pos; lines?: string[] }

export interface Briefing {
  major?: string; exactLocation?: string; type?: string; hazards?: string; access?: string; number?: string; emergencyServices?: string;
}

export interface Scene {
  id: string;
  title: string;
  mode: 'learn' | 'full_scene';
  briefing: Briefing;
  startClock?: string;
  targetSeconds?: number;
  casualties: { ref: string; position: Pos }[];
  bystanders?: Bystander[];
  teaching?: string[];
}

export interface Content {
  vocab: { hazards: Record<string, { description: string }> };
  rules: Rules;
  actionList: Action[];
  actions: Map<string, Action>;
  casualties: Map<string, CasualtyDef>;
  sceneList: Scene[];
  scenes: Map<string, Scene>;
  categories: Map<string, Category>;
}

export interface SessionEvent { def: { id: string }; resolved: boolean; missed: boolean; deadlineAt?: number }

export interface Session {
  content: Content;
  scene: Scene;
  seed: string;
  hints: boolean;
  clock: number;
  position: Pos;
  current: string | null;
  order: string[];
  casualties: Map<string, Runtime>;
  hazards: Hazard[];
  events: SessionEvent[];
  messages: Message[];
  ended: boolean;
}

export interface ActionResult { ok: boolean; text: string; correct: boolean; feedback: string | null; seconds: number }

export interface CardField {
  id: string; letter: string; label: string; laterPhase?: boolean; greyed: boolean;
  entries: { text: string; t: number }[];
}

export interface DebriefCasualty {
  id: string; name: string; title: string; correct: string; step: string; assigned: string | null;
  verdict?: 'correct' | 'under' | 'over';
  reason: string; mistakes: string[]; teaching: string[]; missedFindings: string[]; deteriorated?: string;
  stages: { id: string; note?: string; status: string; at: number | null }[];
}

export interface Debrief {
  score: number; penalty: number; seconds: number; targetSeconds: number;
  correctTags: number; total: number; under: number; over: number;
  casualties: DebriefCasualty[];
  items: { points: number; text: string; casualty: string | null; kind: string }[];
  teaching: string[];
}
