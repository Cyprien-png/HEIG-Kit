/** SYL, série 6, exercice 4 : réaliser Fa, Fb et Fc avec un multiplexeur 8→1, 4→1 puis 2→1. */
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C, Fly, Header, MONO, Mux, type MuxGeo, SANS, Svg, type TableGeo, TruthTable, Val, cellPos, dataLabel, groupPos, lerp, ramp, useLines } from "heigkit";

const TAG = "SYL · Série 6 · Exercice 4";
const FUNCS = [
  { name: "Fa", minterms: "0, 1, 3, 4, 5, 6, 7" },
  { name: "Fb", minterms: "0, 1, 4, 5, 6, 7" },
  { name: "Fc", minterms: "0, 1, 5, 7" },
];

const Formula: React.FC<{ name: string; minterms: string; size?: number }> = ({ name, minterms, size = 40 }) => (
  <span style={{ fontFamily: MONO, fontSize: size, color: C.text, whiteSpace: "nowrap" }}>
    <b>{name}</b>
    <span style={{ color: C.dim }}>(C, B, A) = </span>
    <span style={{ color: C.sel }}>Σ</span> <span style={{ color: C.one }}>{minterms}</span>
  </span>
);

// ───────────────────────────── Intro ─────────────────────────────
const Intro: React.FC = () => {
  const f = useCurrentFrame();
  const { i2, i3 } = useLines();
  const title = ramp(f, 6, 24);
  const badge = ramp(f, i3.s, 18);
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 150, top: 150, fontFamily: SANS, opacity: title, transform: `translateY(${lerp(30, 0, title)}px)` }}>
        <div style={{ color: C.one, fontSize: 26, letterSpacing: 4, fontWeight: 600 }}>SYSTÈMES LOGIQUES · SÉRIE 6 · EXERCICE 4</div>
        <div style={{ color: C.text, fontSize: 96, fontWeight: 800, letterSpacing: -2, lineHeight: 1.05, marginTop: 18 }}>
          Réaliser une fonction
          <br />
          avec un <span style={{ color: C.one }}>multiplexeur</span>
        </div>
      </div>
      <div style={{ position: "absolute", left: 150, top: 520, display: "flex", flexDirection: "column", gap: 22 }}>
        {FUNCS.map((fn, i) => {
          const p = ramp(f, i2.s + i * 12, 20);
          return (
            <div key={fn.name} style={{ opacity: p, transform: `translateX(${lerp(-40, 0, p)}px)`, padding: "16px 30px", borderRadius: 18, background: "rgba(18,28,58,0.8)", border: `1px solid ${C.line}`, width: "fit-content" }}>
              <Formula {...fn} />
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", right: 150, top: 560, display: "flex", flexDirection: "column", gap: 20, alignItems: "flex-end", fontFamily: SANS }}>
        {["MUX 8 → 1", "MUX 4 → 1"].map((label, i) => {
          const p = ramp(f, i2.s + i2.d * (0.55 + i * 0.25), 18);
          return (
            <div key={label} style={{ opacity: p, transform: `scale(${lerp(0.85, 1, p)})`, fontSize: 44, fontWeight: 800, color: C.bg0, background: i ? C.sel : C.one, padding: "10px 28px", borderRadius: 16 }}>
              {label}
            </div>
          );
        })}
        <div style={{ opacity: badge, transform: `translateY(${lerp(16, 0, badge)}px)`, marginTop: 26, fontSize: 34, color: C.text, fontWeight: 600 }}>Une seule recette, trois fonctions.</div>
      </div>
    </AbsoluteFill>
  );
};

// ───────────────────────────── Rappel : le multiplexeur ─────────────────────────────
const MuxRecap: React.FC = () => {
  const f = useCurrentFrame();
  const { m1, m2, m3, m4, m5 } = useLines();
  const g: MuxGeo = { x: 830, y: 270, w: 290, n: 4, gap: 96, selGap: 46 };
  const cycling = f >= m4.s && f < m5.s;
  const selected = f < m4.s ? null : cycling ? Math.floor((f - m4.s) / 26) % 4 : 2;
  const flow = selected === null ? 0 : ramp(f, m4.s, 14);
  const bits = selected === null ? [null, null] : [String(selected & 1), String((selected >> 1) & 1)];
  const lock = ramp(f, m5.s, 16);
  return (
    <AbsoluteFill>
      <Header title="Le multiplexeur, un aiguillage" tag="Rappel" />
      <Svg>
        <Mux g={g} frame={f} appear={ramp(f, m1.s, 30)} sel={["Sel0", "Sel1"]} selBits={bits} selAppear={ramp(f, m3.s, 16)} selected={selected} flow={flow} />
        {[0, 1, 2, 3].map((i) => {
          const pos = dataLabel(g, i);
          const dim = selected !== null && selected !== i ? lerp(1, 0.3, flow) : 1;
          return <Val key={i} x={pos.x - 10} y={pos.y} label={`D${i}`} size={54} opacity={ramp(f, m2.s + i * 5, 16) * dim} glow={selected === i} />;
        })}
        {selected !== null ? (
          <g opacity={flow} fontFamily={MONO}>
            <rect x={150} y={330} width={420} height={230} rx={26} fill={C.panel} fillOpacity={0.85} stroke={C.sel} strokeOpacity={0.6} strokeWidth={2} />
            <text x={360} y={385} textAnchor="middle" fontFamily={SANS} fontSize={26} fill={C.dim}>
              Sélection (Sel1 Sel0)
            </text>
            <text x={360} y={480} textAnchor="middle" fontSize={84} fontWeight={700} fill={C.sel}>
              {bits[1]}
              {bits[0]}
              <tspan fill={C.dim} fontSize={50}>
                {" = "}
              </tspan>
              <tspan fill={C.text}>{selected}</tspan>
            </text>
            <text x={360} y={535} textAnchor="middle" fontFamily={SANS} fontSize={26} fill={C.text} opacity={lock}>
              Y = D2, le reste est ignoré
            </text>
          </g>
        ) : null}
      </Svg>
    </AbsoluteFill>
  );
};

// ───────────────────────────── Une fonction, de la table au multiplexeur ─────────────────────────────
const T: TableGeo = { x: 110, y: 262, rowH: 60, vars: ["C", "B", "A"] };
const M8: MuxGeo = { x: 1470, y: 196, w: 240, n: 8, gap: 59, selGap: 40 };
const M4: MuxGeo = { x: 1470, y: 290, w: 240, n: 4, gap: 86, selGap: 42 };
const M2: MuxGeo = { x: 1470, y: 370, w: 240, n: 2, gap: 112, selGap: 44 };

const CASES = [
  { a: "0", b: "0", r: "0" },
  { a: "1", b: "1", r: "1" },
  { a: "0", b: "1", r: "A" },
  { a: "1", b: "0", r: "/A" },
];

/** The four possible pairs of a function when A changes, and what to wire for each. */
const Legend: React.FC<{ f: number; times: number[]; x: number; y: number; dim?: number }> = ({ f, times, x, y, dim = 1 }) => (
  <g opacity={dim}>
    {CASES.map((c, i) => {
      const p = ramp(f, times[i], 16);
      const pulse = 1 - ramp(f, times[i] + 16, 30);
      return (
        <g key={i} opacity={p} transform={`translate(${x + (i % 2) * 222} ${y + Math.floor(i / 2) * 200 + lerp(20, 0, p)})`}>
          <rect width={206} height={180} rx={22} fill={C.panel} fillOpacity={0.9} stroke={C.line} strokeWidth={1.5} />
          <rect width={206} height={180} rx={22} fill="none" stroke={C.sel} strokeWidth={3} opacity={pulse * p} />
          <text x={22} y={56} fontFamily={MONO} fontSize={20} fill={C.dim}>
            A=0
          </text>
          <text x={22} y={122} fontFamily={MONO} fontSize={20} fill={C.dim}>
            A=1
          </text>
          <Val x={96} y={50} label={c.a} size={38} />
          <Val x={96} y={116} label={c.b} size={38} />
          <path d="M124 83 h14" stroke={C.dim} strokeWidth={3} strokeLinecap="round" />
          <path d="M134 76 l8 7 l-8 7" fill="none" stroke={C.dim} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
          <Val x={163} y={83} label={c.r} size={c.r.length > 1 ? 34 : 42} glow />
        </g>
      );
    })}
  </g>
);

/** When each step of a function's scene starts, in frames of the scene; a step left out does not happen. */
type Steps = {
  table: number;
  hiRow?: { s: number; e: number; row: number; color?: string };
  sweep?: { s: number; e: number };
  tagline?: { s: number; e: number };
  mux8?: number;
  sel8?: number;
  fly8?: number;
  check?: { bits: number; row: number; flow: number; e: number };
  mux4?: number;
  colA?: number;
  group?: number;
  legend?: number[];
  legendStatic?: boolean;
  pairs?: number;
  fly4?: number;
  mux2?: number;
  halves?: number[];
  fly2?: number;
  note?: { s: number; text: string; sub?: string };
};

const FnScene: React.FC<{ fn: number; title: string; values: string[]; pairs: string[]; halves?: string[]; steps: Steps }> = ({ fn, title, values, pairs, halves, steps }) => {
  const f = useCurrentFrame();
  const { name, minterms } = FUNCS[fn];
  const NEVER = 1e9;
  const tM8 = steps.mux8 ?? NEVER;
  const tM4 = steps.mux4 ?? NEVER;
  const tM2 = steps.mux2 ?? NEVER;
  const o8 = ramp(f, tM8, 22) * (1 - ramp(f, tM4 - 4, 14));
  const o4 = ramp(f, tM4 + 10, 22) * (1 - ramp(f, tM2 - 4, 14));
  const o2 = ramp(f, tM2 + 10, 22);

  let hi: { row: number; strength: number; color?: string } | null = null;
  if (steps.hiRow && f >= steps.hiRow.s && f < steps.hiRow.e + 10) {
    hi = { row: steps.hiRow.row, strength: ramp(f, steps.hiRow.s, 10) * (1 - ramp(f, steps.hiRow.e, 10)), color: steps.hiRow.color };
  }
  if (steps.sweep && f >= steps.sweep.s && f < steps.sweep.e) {
    hi = { row: Math.min(7, Math.floor(((f - steps.sweep.s) / (steps.sweep.e - steps.sweep.s)) * 8)), strength: 1 };
  }
  const ck = steps.check;
  const checking = ck !== undefined && f >= ck.bits && f < ck.e + 12;
  if (ck && checking) hi = { row: ck.row, strength: ramp(f, ck.bits + 20, 12) * (1 - ramp(f, ck.e, 12)) };
  const ckFlow = ck && checking ? ramp(f, ck.flow, 14) * (1 - ramp(f, ck.e, 12)) : 0;
  const ckBits = ck && checking ? [ck.row & 1, (ck.row >> 1) & 1, (ck.row >> 2) & 1].map(String) : undefined;

  const band2 = steps.group !== undefined ? ramp(f, steps.group, 20) : 0;
  const band4 = steps.halves ? ramp(f, steps.halves[0] - 6, 20) : 0;
  const halvesP = (halves ?? []).map((_, j) => (steps.halves ? ramp(f, steps.halves[j], 18) : 0));
  const groups = [
    { size: 2, labels: pairs, progress: pairs.map((_, i) => (steps.pairs !== undefined ? ramp(f, steps.pairs + i * 9, 16) : 0)), band: band2 * (1 - band4), dim: halvesP.some((p) => p > 0) ? 0.45 : 1 },
    ...(halves ? [{ size: 4, labels: halves, progress: halvesP, band: band4 }] : []),
  ];
  const legendTimes = steps.legend ?? [0, 0, 0, 0];
  const showLegend = steps.legend !== undefined || steps.legendStatic;
  const noteP = steps.note ? ramp(f, steps.note.s, 18) : 0;
  const tagP = steps.tagline ? ramp(f, steps.tagline.s, 18) * (1 - ramp(f, steps.tagline.e, 14)) : 0;

  return (
    <AbsoluteFill>
      <Header title={title} tag={TAG} />
      <div style={{ position: "absolute", left: 96, top: 176, opacity: ramp(f, steps.table, 20) }}>
        <Formula name={name} minterms={minterms} size={34} />
      </div>
      <Svg>
        <TruthTable
          t={T}
          name={name}
          values={values}
          appear={ramp(f, steps.table, 18)}
          rows={(f - steps.table - 8) / 4}
          hi={hi}
          emphasis={{ col: "A", strength: steps.colA !== undefined ? ramp(f, steps.colA, 14) * (1 - band4) : 0 }}
          groups={groups}
        />
        {showLegend ? <Legend f={f} times={legendTimes} x={836} y={330} dim={steps.legendStatic ? 0.9 * ramp(f, 10, 20) : 1} /> : null}
        {showLegend ? (
          <text x={1050} y={300} textAnchor="middle" fontFamily={SANS} fontSize={24} fill={C.dim} opacity={ramp(f, legendTimes[0], 16)}>
            Les 4 cas d’une paire
          </text>
        ) : null}
        {tagP > 0 ? (
          <g opacity={tagP} fontFamily={SANS}>
            <text x={1000} y={500} textAnchor="middle" fontSize={40} fontWeight={700} fill={C.text}>
              Table de vérité
            </text>
            <text x={1000} y={572} textAnchor="middle" fontSize={64} fontWeight={800} fill={C.one}>
              ≡
            </text>
            <text x={1000} y={640} textAnchor="middle" fontSize={40} fontWeight={700} fill={C.text}>
              Multiplexeur
            </text>
          </g>
        ) : null}
        {o8 > 0 ? (
          <g opacity={o8}>
            <Mux g={M8} frame={f} appear={ramp(f, tM8, 26)} title="MUX 8 → 1" sel={["A", "B", "C"]} selAppear={ramp(f, steps.sel8 ?? tM8, 16)} selBits={ckBits} selected={ck && checking ? ck.row : null} flow={ckFlow} out={name} outValue={ck && checking && ckFlow > 0 ? values[ck.row] : null} />
            {steps.fly8 !== undefined ? values.map((v, i) => <Fly key={i} f={f} start={steps.fly8! + i * 4} from={cellPos(T, i, "F")} to={dataLabel(M8, i)} label={v} />) : null}
          </g>
        ) : null}
        {o4 > 0 ? (
          <g opacity={o4}>
            <Mux g={M4} frame={f} appear={ramp(f, tM4 + 10, 26)} title="MUX 4 → 1" sel={["B", "C"]} out={name} />
            {steps.fly4 !== undefined ? pairs.map((v, i) => <Fly key={i} f={f} start={steps.fly4! + i * 6} from={groupPos(T, 0, 2, i)} to={dataLabel(M4, i)} label={v} />) : null}
          </g>
        ) : null}
        {o2 > 0 && halves ? (
          <g opacity={o2}>
            <Mux g={M2} frame={f} appear={ramp(f, tM2 + 10, 26)} title="MUX 2 → 1" sel={["C"]} out={name} />
            {steps.fly2 !== undefined ? halves.map((v, j) => <Fly key={j} f={f} start={steps.fly2! + j * 8} from={groupPos(T, 1, 4, j)} to={dataLabel(M2, j)} label={v} />) : null}
          </g>
        ) : null}
        {steps.note && noteP > 0 ? (
          <g opacity={noteP} transform={`translate(0 ${lerp(16, 0, noteP)})`} fontFamily={SANS}>
            <rect x={1150} y={800} width={660} height={steps.note.sub ? 104 : 68} rx={18} fill={C.varA} fillOpacity={0.12} stroke={C.varA} strokeOpacity={0.7} strokeWidth={2} />
            <text x={1480} y={842} textAnchor="middle" fontSize={28} fontWeight={700} fill={C.text}>
              {steps.note.text}
            </text>
            {steps.note.sub ? (
              <text x={1480} y={882} textAnchor="middle" fontSize={24} fill={C.dim}>
                {steps.note.sub}
              </text>
            ) : null}
          </g>
        ) : null}
      </Svg>
    </AbsoluteFill>
  );
};

const Fa: React.FC = () => {
  const { a1, a2, a3, a4, a5, a6, a7, a8, r1, r2, r3, r5, r6, r7, r8, r9 } = useLines();
  return (
    <FnScene
      fn={0}
      title="Fa : de la table au multiplexeur"
      values={["1", "1", "0", "1", "1", "1", "1", "1"]}
      pairs={["1", "A", "1", "1"]}
      steps={{
        table: a1.s,
        hiRow: { s: a2.s, e: a3.s - 6, row: 2, color: C.bad },
        mux8: a3.s,
        tagline: { s: a3.s + 6, e: a5.s },
        sweep: { s: a4.s, e: a4.e },
        sel8: a5.s,
        fly8: a6.s,
        check: { bits: a7.s + 20, row: 2, flow: a8.s, e: r1.s - 8 },
        mux4: r1.s,
        colA: r2.s,
        group: r3.s,
        legend: [r5.s, r6.s, r7.s, r8.s],
        pairs: r9.s,
        fly4: r9.s + 50,
      }}
    />
  );
};

const Fb: React.FC = () => {
  const { b1, b2, b3, b4, b5, b6, b7, b8 } = useLines();
  return (
    <FnScene
      fn={1}
      title="Fb : et si A ne servait à rien ?"
      values={["1", "1", "0", "0", "1", "1", "1", "1"]}
      pairs={["1", "0", "1", "1"]}
      halves={["/B", "1"]}
      steps={{
        legendStatic: true,
        table: b1.s,
        mux8: b1.s + 12,
        fly8: b2.s,
        mux4: b3.s,
        group: b3.s,
        pairs: b3.s + 14,
        fly4: b3.s + 62,
        note: { s: b4.s, text: "A a disparu : Fb ne dépend que de C et B", sub: "On peut encore réduire le multiplexeur" },
        mux2: b5.s,
        halves: [b6.s, b7.s],
        fly2: b8.s,
      }}
    />
  );
};

const Fc: React.FC = () => {
  const { c1, c2, c3, c4, c5 } = useLines();
  return (
    <FnScene
      fn={2}
      title="Fc : même recette"
      values={["1", "1", "0", "0", "0", "1", "0", "1"]}
      pairs={["1", "0", "A", "A"]}
      halves={["/B", "A"]}
      steps={{
        legendStatic: true,
        table: c1.s,
        mux4: c1.s + 6,
        group: c2.s,
        pairs: c2.s + 8,
        fly4: c2.s + 56,
        mux2: c3.s,
        halves: [c3.s + 30, c4.s],
        fly2: c5.s,
      }}
    />
  );
};

// ───────────────────────────── Récap ─────────────────────────────
const Recap: React.FC = () => {
  const f = useCurrentFrame();
  const { z1, z2, z3, z4, z5 } = useLines();
  const steps = [
    { n: "1", t: "Écris la table de vérité", d: "Les mintermes donnent les lignes à 1.", at: z1.s + 24 },
    { n: "2", t: "Choisis les variables de sélection", d: "Respecte les poids : C, B, A → 2, 1, 0.", at: z2.s },
    { n: "3", t: "Regroupe et compare", d: "Dans chaque groupe, compare F à la variable qui reste.", at: z3.s },
  ];
  const endP = ramp(f, z5.s, 18);
  const goP = ramp(f, z5.s + z5.d * 0.7, 18);
  return (
    <AbsoluteFill>
      <Header title="La recette" tag="À retenir" />
      <div style={{ position: "absolute", left: 96, top: 210, display: "flex", flexDirection: "column", gap: 24, fontFamily: SANS }}>
        {steps.map((s) => {
          const p = ramp(f, s.at, 18);
          return (
            <div key={s.n} style={{ opacity: p, transform: `translateX(${lerp(-40, 0, p)}px)`, display: "flex", alignItems: "center", gap: 28, width: 980, padding: "22px 30px", borderRadius: 22, background: "rgba(18,28,58,0.85)", border: `1px solid ${C.line}` }}>
              <div style={{ width: 72, height: 72, borderRadius: 20, background: C.one, color: C.bg0, fontSize: 42, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{s.n}</div>
              <div>
                <div style={{ color: C.text, fontSize: 38, fontWeight: 700 }}>{s.t}</div>
                <div style={{ color: C.dim, fontSize: 26, marginTop: 4 }}>{s.d}</div>
              </div>
            </div>
          );
        })}
      </div>
      <Svg>
        <g opacity={ramp(f, z4.s, 18)}>
          <text x={1454} y={250} textAnchor="middle" fontFamily={SANS} fontSize={26} fill={C.dim}>
            Les 4 cas d’une paire
          </text>
          <Legend f={f} times={[0, 1, 2, 3].map((i) => z4.s + i * 7)} x={1240} y={280} />
        </g>
      </Svg>
      <div style={{ position: "absolute", left: 96, top: 720, fontFamily: SANS, opacity: endP, transform: `translateY(${lerp(18, 0, endP)}px)`, fontSize: 34, color: C.text, padding: "18px 30px", borderRadius: 20, background: "rgba(255,122,198,0.1)", border: `1.5px solid ${C.varA}` }}>
        Une variable disparaît ? <b style={{ color: C.varA }}>Multiplexeur plus petit.</b>
      </div>
      <div style={{ position: "absolute", right: 150, top: 740, fontFamily: SANS, opacity: goP, transform: `scale(${lerp(0.8, 1, goP)})`, fontSize: 60, fontWeight: 800, color: C.one }}>À toi de jouer.</div>
    </AbsoluteFill>
  );
};

export const scenes = { intro: Intro, mux: MuxRecap, fa: Fa, fb: Fb, fc: Fc, recap: Recap };
