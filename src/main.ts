import rules from '../content/triage-rules.json';
import { renderCasualty } from './art/index.js';
import vocab from '../content/vocab.json';
import actions from '../content/actions.json';
import walking from '../content/casualties/walking.json';

const app = document.querySelector<HTMLDivElement>('#app')!;
const banner = rules.approved ? '' : `<p style="background:#fff3cd;padding:8px">${rules.notice}</p>`;
const sample = walking.casualties[0];
const { svg } = renderCasualty(sample, { mode: 'approach' }, { vocab, actions, rules });

app.innerHTML = `${banner}<h1>Triage Trainer</h1><p>Work in progress. ${sample.approach}</p><div style="max-width:320px">${svg}</div>`;
