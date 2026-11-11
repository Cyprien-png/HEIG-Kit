/** A multiplexer drawn like the IEC symbol of the SYL course: control block with the select inputs, numbered data inputs, output Y. */
import React from "react";
import { C, MONO, SANS, Val, lerp } from "./ui";

export type MuxGeo = {x: number; y: number; w: number; n: number; gap: number; selGap?: number};

const STUB = 96;
const k = (g: MuxGeo) => Math.log2(g.n);
const selGap = (g: MuxGeo) => g.selGap ?? 42;
const headH = (g: MuxGeo) => Math.max(104, 30 + k(g) * selGap(g));
export const muxH = (g: MuxGeo) => headH(g) + g.n * g.gap + 20;
export const selPin = (g: MuxGeo, j: number) => ({x: g.x, y: g.y + (headH(g) - k(g) * selGap(g)) / 2 + selGap(g) * (j + 0.5)});
export const dataPin = (g: MuxGeo, i: number) => ({x: g.x, y: g.y + headH(g) + 10 + g.gap * (i + 0.5)});
export const outPin = (g: MuxGeo) => ({x: g.x + g.w, y: g.y + headH(g) + 10 + (g.n * g.gap) / 2});
/** Where the value chip of data input i sits. */
export const dataLabel = (g: MuxGeo, i: number) => ({x: g.x - STUB - 40, y: dataPin(g, i).y});
export const outLabel = (g: MuxGeo) => ({x: g.x + g.w + STUB + 50, y: outPin(g).y});

const bez = (p0: number, p1: number, p2: number, p3: number, t: number) =>
	(1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3;

export const Mux: React.FC<{
	g: MuxGeo;
	frame: number;
	appear?: number; // 0→1
	sel: string[]; // names of the select variables, weight 0 first
	selBits?: (string | null)[]; // current value of each select input
	selAppear?: number;
	selected?: number | null; // data input currently routed to Y
	flow?: number; // 0→1 strength of the routed path
	out?: string; // name of the output
	outValue?: string | null;
	title?: string;
}> = ({g, frame, appear = 1, sel, selBits, selAppear = 1, selected = null, flow = 0, out = 'Y', outValue = null, title}) => {
	const h = muxH(g);
	const hh = headH(g);
	const o = outPin(g);
	const dash = 2 * (g.w + h);
	return (
		<g opacity={Math.min(1, appear * 1.4)} transform={`translate(0 ${lerp(24, 0, appear)})`}>
			{title ? (
				<text x={g.x + g.w / 2} y={g.y - 26} textAnchor="middle" fontFamily={SANS} fontSize={30} fontWeight={700} fill={C.text}>
					{title}
				</text>
			) : null}
			{/* glow behind the box */}
			<rect x={g.x} y={g.y} width={g.w} height={h} rx={22} fill="#3b6cff" opacity={0.22} filter="url(#soft)" />
			<rect x={g.x} y={g.y} width={g.w} height={h} rx={22} fill="url(#box)" />
			<rect
				x={g.x}
				y={g.y}
				width={g.w}
				height={h}
				rx={22}
				fill="none"
				stroke="url(#edge)"
				strokeWidth={3}
				strokeDasharray={dash}
				strokeDashoffset={dash * (1 - appear)}
			/>
			{/* control block */}
			<line x1={g.x + 2} x2={g.x + g.w - 2} y1={g.y + hh} y2={g.y + hh} stroke={C.line} strokeWidth={2} />
			<text x={g.x + g.w - 22} y={g.y + 38} textAnchor="end" fontFamily={SANS} fontWeight={800} fontSize={28} letterSpacing={2} fill={C.text}>
				MUX
			</text>
			<text x={g.x + g.w - 22} y={g.y + hh - 16} textAnchor="end" fontFamily={MONO} fontSize={19} fill={C.sel} opacity={0.9}>
				G 0/{g.n - 1}
			</text>
			{/* select inputs */}
			{sel.map((name, j) => {
				const p = selPin(g, j);
				const bit = selBits?.[j] ?? null;
				return (
					<g key={name} opacity={selAppear}>
						<line x1={p.x - STUB} x2={p.x} y1={p.y} y2={p.y} stroke={C.sel} strokeWidth={3} strokeLinecap="round" opacity={0.85} />
						<text x={p.x + 16} y={p.y + 1} dominantBaseline="central" fontFamily={MONO} fontSize={20} fill={C.sel}>
							{j}
						</text>
						<text x={p.x - STUB - 16} y={p.y + 1} textAnchor="end" dominantBaseline="central" fontFamily={MONO} fontWeight={700} fontSize={28} fill={C.sel}>
							{name}
						</text>
						{bit !== null ? (
							<g>
								<rect x={p.x - STUB + 22} y={p.y - 17} width={34} height={34} rx={9} fill={C.bg0} stroke={C.sel} strokeWidth={2} />
								<text x={p.x - STUB + 39} y={p.y + 1} textAnchor="middle" dominantBaseline="central" fontFamily={MONO} fontWeight={700} fontSize={22} fill={C.sel}>
									{bit}
								</text>
							</g>
						) : null}
					</g>
				);
			})}
			{/* data inputs */}
			{Array.from({length: g.n}, (_, i) => {
				const p = dataPin(g, i);
				const on = selected === i;
				const dimmed = selected !== null && !on ? lerp(1, 0.35, flow) : 1;
				return (
					<g key={i} opacity={dimmed}>
						<line x1={p.x - STUB} x2={p.x} y1={p.y} y2={p.y} stroke={on ? C.one : C.dim} strokeWidth={3} strokeLinecap="round" />
						<circle cx={p.x} cy={p.y} r={5} fill={on ? C.one : C.dim} />
						<text x={p.x + 18} y={p.y + 1} dominantBaseline="central" fontFamily={MONO} fontSize={22} fill={on ? C.text : C.dim}>
							{i}
						</text>
					</g>
				);
			})}
			{/* routed path */}
			{selected !== null && flow > 0
				? (() => {
						const p = dataPin(g, selected);
						const x0 = p.x + 44;
						const x3 = o.x;
						const c1 = x0 + (x3 - x0) * 0.55;
						const c2 = x0 + (x3 - x0) * 0.45;
						const t = ((frame % 36) / 36) * 1;
						const px = bez(x0, c1, c2, x3, t);
						const py = bez(p.y, p.y, o.y, o.y, t);
						return (
							<g opacity={flow}>
								<path d={`M${x0} ${p.y} C${c1} ${p.y} ${c2} ${o.y} ${x3} ${o.y}`} fill="none" stroke={C.one} strokeWidth={5} strokeLinecap="round" filter="url(#glow)" />
								<circle cx={px} cy={py} r={8} fill="#ffffff" filter="url(#glow)" />
							</g>
						);
					})()
				: null}
			{/* output */}
			<line x1={o.x} x2={o.x + STUB} y1={o.y} y2={o.y} stroke={flow > 0 ? C.one : C.dim} strokeWidth={3} strokeLinecap="round" />
			<circle cx={o.x} cy={o.y} r={5} fill={flow > 0 ? C.one : C.dim} />
			<text x={o.x - 16} y={o.y + 1} textAnchor="end" dominantBaseline="central" fontFamily={MONO} fontSize={22} fill={C.dim}>
				Y
			</text>
			{outValue ? (
				<Val x={outLabel(g).x} y={o.y} label={outValue} size={52} opacity={flow} glow />
			) : (
				<text x={o.x + STUB + 16} y={o.y + 1} dominantBaseline="central" fontFamily={MONO} fontWeight={700} fontSize={30} fill={C.text}>
					{out}
				</text>
			)}
		</g>
	);
};
