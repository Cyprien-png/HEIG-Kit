/** Look of the high quality videos: colors, fonts, easing, value chips, background, header and subtitles. */
import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { useScene } from "./context";

export const C = {
	bg0: '#070b18',
	bg1: '#0e1630',
	panel: '#121c3a',
	line: '#2a3a66',
	text: '#eaf0ff',
	dim: '#8493b8',
	one: '#3fe0c5',
	zero: '#6f7fa6',
	sel: '#ffc857',
	varA: '#ff7ac6',
	varB: '#9d8cff',
	bad: '#ff6b6b',
};
export const SANS = 'system-ui, -apple-system, "Helvetica Neue", sans-serif';
export const MONO = '"SF Mono", Menlo, monospace';

/** 0 before `start`, 1 after `start + dur` frames, eased in between: the progress of an appearance. */
export const ramp = (f: number, start: number, dur = 16) =>
	interpolate(f, [start, start + dur], [0, 1], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp',
		easing: Easing.out(Easing.cubic),
	});
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

export const colorOf = (label: string) =>
	label === '1' ? C.one : label === '0' ? C.zero : label.includes('A') ? C.varA : label.includes('B') ? C.varB : C.sel;

/** A small value chip: 0, 1, A, /A, /B… */
export const Val: React.FC<{x: number; y: number; label: string; size?: number; opacity?: number; scale?: number; glow?: boolean}> = ({
	x,
	y,
	label,
	size = 44,
	opacity = 1,
	scale = 1,
	glow = false,
}) => {
	const col = colorOf(label);
	const w = label.length > 1 ? size * 1.35 : size;
	return (
		<g transform={`translate(${x} ${y}) scale(${scale})`} opacity={opacity} filter={glow ? 'url(#glow)' : undefined}>
			<rect x={-w / 2} y={-size / 2} width={w} height={size} rx={size * 0.28} fill={col} fillOpacity={0.14} stroke={col} strokeWidth={2} />
			<text x={0} y={size * 0.02} textAnchor="middle" dominantBaseline="central" fontFamily={MONO} fontWeight={700} fontSize={size * 0.58} fill={col}>
				{label}
			</text>
		</g>
	);
};

export const Defs: React.FC = () => (
	<defs>
		<filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
			<feGaussianBlur stdDeviation="7" result="b" />
			<feMerge>
				<feMergeNode in="b" />
				<feMergeNode in="SourceGraphic" />
			</feMerge>
		</filter>
		<filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
			<feGaussianBlur stdDeviation="18" />
		</filter>
		<linearGradient id="box" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0" stopColor="#1a2750" />
			<stop offset="1" stopColor="#101937" />
		</linearGradient>
		<linearGradient id="edge" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" stopColor="#6aa8ff" />
			<stop offset="1" stopColor="#3fe0c5" />
		</linearGradient>
	</defs>
);

export const Background: React.FC = () => {
	const f = useCurrentFrame();
	const drift = Math.sin(f / 140) * 60;
	return (
		<AbsoluteFill style={{background: `radial-gradient(1200px 800px at ${55 + drift / 30}% 35%, ${C.bg1}, ${C.bg0} 70%)`}}>
			<svg width={1920} height={1080}>
				<defs>
					<pattern id="grid" width={60} height={60} patternUnits="userSpaceOnUse">
						<path d="M60 0H0V60" fill="none" stroke="#ffffff" strokeOpacity={0.035} strokeWidth={1} />
					</pattern>
					<radialGradient id="blobA">
						<stop offset="0" stopColor="#3b5bff" stopOpacity={0.2} />
						<stop offset="1" stopColor="#3b5bff" stopOpacity={0} />
					</radialGradient>
					<radialGradient id="blobB">
						<stop offset="0" stopColor="#3fe0c5" stopOpacity={0.13} />
						<stop offset="1" stopColor="#3fe0c5" stopOpacity={0} />
					</radialGradient>
				</defs>
				<circle cx={380 + drift} cy={860} r={620} fill="url(#blobA)" />
				<circle cx={1560 - drift} cy={220} r={600} fill="url(#blobB)" />
				<rect width={1920} height={1080} fill="url(#grid)" />
			</svg>
		</AbsoluteFill>
	);
};

/** Title of a scene, top left, with a small tag above it (course, series, exercise). */
export const Header: React.FC<{title: string; tag?: string}> = ({title, tag = ''}) => {
	const f = useCurrentFrame();
	const p = ramp(f, 4, 20);
	return (
		<div style={{position: 'absolute', left: 90, top: 56, opacity: p, transform: `translateY(${lerp(-14, 0, p)}px)`, fontFamily: SANS}}>
			<div style={{color: C.one, fontSize: 22, letterSpacing: 3, fontWeight: 600, textTransform: 'uppercase'}}>{tag}</div>
			<div style={{color: C.text, fontSize: 50, fontWeight: 700, marginTop: 6, letterSpacing: -0.5}}>{title}</div>
		</div>
	);
};

/** A full-screen SVG in the 1920×1080 coordinates of the video. */
export const Svg: React.FC<{children: React.ReactNode}> = ({children}) => (
	<svg width={1920} height={1080} style={{position: 'absolute', inset: 0}}>
		<Defs />
		{children}
	</svg>
);

/** Subtitles of the scene: one sentence at a time, each shown for its share of its line. Added to every scene by the runtime. */
export const Subtitles: React.FC = () => {
	const f = useCurrentFrame();
	const sentences = useScene().list.flatMap((line) => {
		const parts = line.text.split(/(?<=[.!?])\s+/).filter(Boolean);
		const total = parts.reduce((n, p) => n + p.length, 0);
		let acc = 0;
		return parts.map((text) => {
			const s = line.s + Math.round((acc / total) * line.d);
			acc += text.length;
			return {text, s, e: line.s + Math.round((acc / total) * line.d)};
		});
	});
	const cur = sentences.find((s, i) => f >= s.s && f < (sentences[i + 1]?.s ?? s.e + 12));
	if (!cur) return null;
	const p = ramp(f, cur.s, 8);
	return (
		<div style={{position: 'absolute', left: 0, right: 0, bottom: 44, display: 'flex', justifyContent: 'center'}}>
			<div
				style={{
					opacity: p,
					maxWidth: 1400,
					padding: '12px 28px',
					borderRadius: 16,
					background: 'rgba(7,11,24,0.72)',
					border: '1px solid rgba(255,255,255,0.08)',
					color: C.text,
					fontFamily: SANS,
					fontSize: 30,
					lineHeight: 1.3,
					textAlign: 'center',
				}}
			>
				{cur.text}
			</div>
		</div>
	);
};
