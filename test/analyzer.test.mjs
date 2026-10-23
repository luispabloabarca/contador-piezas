// Ejecutar con:  node test/analyzer.test.mjs
import { analyze } from '../js/analyzer.js';
import { makeSample } from '../js/sample.js';

let fails = 0;
for (const seed of [1, 7, 21, 42, 99]) {
  const { img, truth } = makeSample({ seed });
  const t0 = Date.now();
  const { summary: s } = analyze(img);
  const got = { enteras: s.enteras, partidas: s.partidas, grupoUnidades: s.unidadesEnGrupos, migas: s.migas };
  const ok = Object.keys(truth).every(k => truth[k] === got[k]) && s.formaPredominante === 'palito';
  if (!ok) fails++;
  console.log(`${ok ? 'OK  ' : 'FALLA'} seed=${seed} ${Date.now() - t0}ms esperado=${JSON.stringify(truth)} obtenido=${JSON.stringify(got)} forma=${s.formaPredominante}`);
}
process.exit(fails ? 1 : 0);
