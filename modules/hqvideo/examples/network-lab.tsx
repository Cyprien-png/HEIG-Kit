/** RXI labo 4 : mise en place d'un réseau LAN (IP fixes, ping, routeur Cisco, DHCP et DORA, sauvegarde, Netcat : chat, fichier, serveur Web, client HTTP), avec zooms. */
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Broadcast, C, Camera, Device, type DeviceKind, FieldCard, FileIcon, Header, Lens, lerp, Link, MONO, NET, Packet, packetAt, type Pt, ramp, SANS, SeqDiagram, Svg, Terminal, type TermLine, useLines, useScene, ZoomBadge, zoomScale } from "heigkit";

const TAG = "RXI · Labo 4 · Réseau LAN";
const ZOOM = 2.8;

// ───────────────────────────── Shared pieces ─────────────────────────────
type Node = { key: string; kind: DeviceKind; at: Pt; label: string; sub?: string; size?: number; o?: number; act?: number; color?: string; subColor?: string };
type Edge = { a: string; b: string; p?: number; label?: string; dashed?: boolean; active?: number };

/** A network: links under, devices over, then the packets given as children. */
const Net: React.FC<{ f: number; nodes: Node[]; links: Edge[]; children?: React.ReactNode }> = ({ f, nodes, links, children }) => {
  const at = (k: string) => nodes.find((n) => n.key === k)!.at;
  return (
    <g>
      {links.map((l, i) => (
        <Link key={i} from={at(l.a)} to={at(l.b)} p={l.p ?? 1} label={l.label} dashed={l.dashed} active={l.active} f={f} />
      ))}
      {nodes.map((n) => (
        <Device key={n.key} x={n.at.x} y={n.at.y} kind={n.kind} label={n.label} sub={n.sub} size={n.size ?? 120} opacity={n.o ?? 1} active={n.act ?? 0} color={n.color} subColor={n.subColor} />
      ))}
      {children}
    </g>
  );
};

/** Positions of the overview (objectives 1 to 5). */
const OV = { r: { x: 960, y: 250 }, sw: { x: 960, y: 520 }, pc1: { x: 560, y: 780 }, pc2: { x: 1360, y: 780 } };
/** Positions of the Netcat scenes: everything on one line, the terminals above. */
const HZ = { pc1: { x: 480, y: 640 }, sw: { x: 960, y: 640 }, pc2: { x: 1440, y: 640 } };

/** Camera of an overview scene: zooms back out at its start (`back`), and into `focus` from `inAt`. */
const useOverviewCam = (back: boolean, inAt?: number) => {
  const f = useCurrentFrame();
  const scale = zoomScale(f, { outAt: back ? 0 : undefined, inAt, max: ZOOM, dur: 30 });
  const opacity = (back ? ramp(f, 0, 12) : 1) * (inAt !== undefined ? 1 - ramp(f, inAt + 12, 18) : 1);
  return { scale, opacity };
};

/** Camera of a zoom scene: it grows in at the start and shrinks away from `outAt`. */
const useDetailCam = (outAt: number) => {
  const f = useCurrentFrame();
  const scale = lerp(0.72, 1, ramp(f, 0, 22)) * lerp(1, 0.72, ramp(f, outAt, 24));
  const opacity = ramp(f, 0, 14) * (1 - ramp(f, outAt + 6, 18));
  return { scale, opacity };
};

const Card: React.FC<{ x: number; y: number; w: number; p: number; color?: string; title?: string; children: React.ReactNode; big?: boolean }> = ({ x, y, w, p, color = C.one, title, children, big }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      width: w,
      opacity: p,
      transform: `translateY(${lerp(16, 0, p)}px)`,
      padding: "16px 24px",
      borderRadius: 18,
      background: "rgba(18,28,58,0.92)",
      border: `1.5px solid ${color}`,
      fontFamily: SANS,
      color: C.text,
      fontSize: big ? 30 : 25,
      lineHeight: 1.4,
    }}
  >
    {title ? <div style={{ color, fontSize: 20, fontWeight: 800, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 6 }}>{title}</div> : null}
    {children}
  </div>
);

const M: React.FC<{ children: React.ReactNode; c?: string }> = ({ children, c = C.sel }) => <span style={{ fontFamily: MONO, color: c }}>{children}</span>;

const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

// ───────────────────────────── Intro ─────────────────────────────
const OBJ = ["LAN & IP fixes", "Routeur Cisco", "Serveur DHCP", "Analyse DHCP", "Sauvegarde", "Netcat"];

const Intro: React.FC = () => {
  const f = useCurrentFrame();
  const { i2, i3, i4 } = useLines();
  const t = ramp(f, 4, 24);
  const nodes: Node[] = [
    { key: "pc1", kind: "laptop", at: OV.pc1, label: "PC1", o: ramp(f, i2.s, 16) },
    { key: "pc2", kind: "laptop", at: OV.pc2, label: "PC2", o: ramp(f, i2.s + 6, 16) },
    { key: "sw", kind: "switch", at: OV.sw, label: "Cheseaux_SR1", o: ramp(f, i2.s + 12, 16) },
    { key: "r", kind: "router", at: OV.r, label: "Cheseaux", o: ramp(f, i2.s + i2.d * 0.45, 16), color: C.sel },
  ];
  const links: Edge[] = [
    { a: "pc1", b: "sw", p: ramp(f, i2.s + 16, 20) },
    { a: "pc2", b: "sw", p: ramp(f, i2.s + 22, 20) },
    { a: "r", b: "sw", p: ramp(f, i2.s + i2.d * 0.45 + 8, 20) },
  ];
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 120, top: 150, fontFamily: SANS, opacity: t, transform: `translateY(${lerp(30, 0, t)}px)` }}>
        <div style={{ color: C.one, fontSize: 26, letterSpacing: 4, fontWeight: 600 }}>RÉSEAUX · RXI · LABO 4</div>
        <div style={{ color: C.text, fontSize: 92, fontWeight: 800, letterSpacing: -2, lineHeight: 1.05, marginTop: 18 }}>
          Mise en place
          <br />
          d'un réseau <span style={{ color: C.one }}>LAN</span>
        </div>
      </div>
      <div style={{ position: "absolute", left: 120, top: 520, display: "grid", gridTemplateColumns: "repeat(3, 290px)", gap: 16, fontFamily: SANS }}>
        {OBJ.map((o, i) => {
          const p = ramp(f, i3.s + i * 7, 16);
          const nc = i === 5 && f >= i4.s;
          return (
            <div key={o} style={{ opacity: p, transform: `translateY(${lerp(14, 0, p)}px)`, display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", borderRadius: 16, background: "rgba(18,28,58,0.88)", border: `1.5px solid ${nc ? C.varA : C.line}` }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: nc ? C.varA : C.one, color: C.bg0, fontWeight: 800, fontSize: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</div>
              <div style={{ color: C.text, fontSize: 24, fontWeight: 600 }}>{o}</div>
            </div>
          );
        })}
      </div>
      <Svg>
        <g transform="translate(650 80) scale(0.8)">
          <Net f={f} nodes={nodes} links={links} />
        </g>
      </Svg>
    </AbsoluteFill>
  );
};

// ───────────────────────────── Objectif 1 : LAN et IP fixes ─────────────────────────────
const Lan: React.FC = () => {
  const f = useCurrentFrame();
  const { l1, l2, l3, l4, l5, l6, l7, l8, l9 } = useLines();
  const inAt = l9.e - 30;
  const cam = useOverviewCam(false, inAt);
  const nodes: Node[] = [
    { key: "pc1", kind: "laptop", at: OV.pc1, label: "PC1", sub: f >= l5.s + 30 ? "10.1.1.2/24" : "Debian", o: ramp(f, l1.s, 16), act: ramp(f, l5.s, 10) * (1 - ramp(f, l6.s, 10)) },
    { key: "pc2", kind: "laptop", at: OV.pc2, label: "PC2", sub: f >= l6.s + 30 ? "10.1.1.3/24" : "Debian", o: ramp(f, l1.s + 8, 16), act: ramp(f, l6.s, 10) * (1 - ramp(f, l7.s, 10)) },
    { key: "sw", kind: "switch", at: OV.sw, label: "Cheseaux_SR1", sub: "bridge = switch", o: ramp(f, l2.s, 16), act: ramp(f, l3.s, 10) * (1 - ramp(f, l4.s, 10)) },
  ];
  const links: Edge[] = [
    { a: "pc1", b: "sw", p: ramp(f, l2.s + 14, 20), active: ramp(f, l3.s, 10) * (1 - ramp(f, l4.s, 10)) },
    { a: "pc2", b: "sw", p: ramp(f, l2.s + 20, 20), active: ramp(f, l3.s, 10) * (1 - ramp(f, l4.s, 10)) },
  ];
  const t1: TermLine[] = [{ at: l5.s + 4, text: "sudo ip address add 10.1.1.2/24 dev ens3" }];
  const t2: TermLine[] = [{ at: l6.s + 4, text: "sudo ip address add 10.1.1.3/24 dev ens3" }];
  return (
    <AbsoluteFill>
      <Header title="Objectif 1 · Le réseau local" tag={TAG} />
      <Camera focus={{ x: 960, y: 650 }} scale={cam.scale} opacity={cam.opacity}>
        <Terminal f={f} x={90} y={190} w={820} title="PC1 — console" prompt="labo@pc1:~$" lines={t1} rows={1} opacity={ramp(f, l4.s, 16)} fontSize={22} />
        <Terminal f={f} x={1010} y={190} w={820} title="PC2 — console" prompt="labo@pc2:~$" lines={t2} rows={1} opacity={ramp(f, l4.s + 6, 16)} fontSize={22} />
        <Card x={90} y={400} w={560} p={ramp(f, l7.s, 18)} title="/24 = masque">
          <span style={{ fontFamily: MONO, fontSize: 34 }}>
            <span style={{ color: C.one }}>10.1.1</span>
            <span style={{ color: C.dim }}>.</span>
            <span style={{ color: C.varA }}>2</span>
          </span>
          <div style={{ fontSize: 22, color: C.dim }}>
            <span style={{ color: C.one }}>24 premiers bits</span> : le réseau 10.1.1.0 · le reste : la machine
          </div>
        </Card>
        <Card x={1270} y={400} w={560} p={ramp(f, l8.s, 18)} title="Même réseau">
          Les deux PC se parlent <b style={{ color: C.one }}>directement</b>, à travers le switch, sans routeur.
        </Card>
        <Svg>
          <Net f={f} nodes={nodes} links={links}>
            <Packet f={f} start={l3.s + 10} from={OV.pc1} via={[OV.sw]} to={OV.pc2} label="trame" color={C.dim} dur={50} />
          </Net>
          <Lens x={430} y={440} w={1060} h={470} label="zoom : ping" p={ramp(f, l9.s, 16)} />
        </Svg>
      </Camera>
    </AbsoluteFill>
  );
};

// ───────────────────────────── Zoom : ping ─────────────────────────────
const ZP = { pc1: { x: 380, y: 360 }, sw: { x: 960, y: 360 }, pc2: { x: 1540, y: 360 } };

const Ping: React.FC = () => {
  const f = useCurrentFrame();
  const { p1, p2, p3, p4, p5 } = useLines();
  const outAt = p5.e - 26;
  const cam = useDetailCam(outAt);
  const nodes: Node[] = [
    { key: "pc1", kind: "laptop", at: ZP.pc1, label: "PC1", sub: "10.1.1.2", size: 150 },
    { key: "sw", kind: "switch", at: ZP.sw, label: "switch", size: 140 },
    { key: "pc2", kind: "laptop", at: ZP.pc2, label: "PC2", sub: "10.1.1.3", size: 150, act: ramp(f, p2.s, 10) * (1 - ramp(f, p3.s, 10)) },
  ];
  const pings = [p1.s + 20, p3.s + 6, p3.s + p3.d * 0.5];
  const term: TermLine[] = [
    { at: p1.s + 4, text: "ping 10.1.1.3" },
    { at: p2.s + 4, out: true, text: "64 bytes from 10.1.1.3: icmp_seq=1 ttl=64 time=0.84 ms" },
    { at: p3.s + 50, out: true, text: "64 bytes from 10.1.1.3: icmp_seq=2 ttl=64 time=0.61 ms" },
    { at: p3.s + p3.d * 0.5 + 44, out: true, text: "64 bytes from 10.1.1.3: icmp_seq=3 ttl=64 time=0.58 ms" },
    { at: p3.s + p3.d * 0.85, out: true, text: "^C  3 packets transmitted, 3 received, 0% packet loss", color: C.one },
    { at: p5.s + 4, text: "ip a show ens3" },
    { at: p5.s + 40, out: true, text: "    inet 10.1.1.2/24 scope global ens3", color: C.sel },
  ];
  return (
    <AbsoluteFill>
      <Header title="Zoom · Le ping" tag={TAG} />
      <ZoomBadge path={["Vue d'ensemble", "ping"]} opacity={ramp(f, 4, 16)} />
      <Camera focus={{ x: 960, y: 540 }} scale={cam.scale} opacity={cam.opacity}>
        <Svg>
          <Net f={f} nodes={nodes} links={[{ a: "pc1", b: "sw" }, { a: "sw", b: "pc2" }]}>
            {pings.map((s, i) => (
              <g key={i}>
                <Packet f={f} start={s} from={ZP.pc1} via={[ZP.sw]} to={ZP.pc2} label="echo request" color={NET.icmp} dur={44} />
                <Packet f={f} start={s + 50} from={ZP.pc2} via={[ZP.sw]} to={ZP.pc1} label="echo reply" color={C.varB} dur={44} labelBelow />
              </g>
            ))}
            <Broadcast f={f} start={p4.s + 8} at={ZP.pc1} color={NET.arp} radius={420} waves={3} />
          </Net>
        </Svg>
        <div style={{ position: "absolute", left: 300, top: 170, opacity: ramp(f, p4.s + 10, 16) * (1 - ramp(f, p5.s, 12)), fontFamily: MONO, fontSize: 26, color: NET.arp, padding: "8px 18px", borderRadius: 14, border: `1.5px solid ${NET.arp}`, background: "rgba(7,11,24,0.85)" }}>
          ARP (broadcast) : « qui a 10.1.1.3 ? »
        </div>
        <Terminal f={f} x={300} y={590} w={1320} title="PC1 — console" prompt="labo@pc1:~$" lines={term} rows={4} fontSize={22} />
      </Camera>
    </AbsoluteFill>
  );
};

// ───────────────────────────── Objectif 2 : le routeur ─────────────────────────────
const Router: React.FC = () => {
  const f = useCurrentFrame();
  const { r1, r2, r3, r4 } = useLines();
  const inAt = r4.e - 30;
  const back = useOverviewCam(true);
  const into = zoomScale(f, { inAt, max: ZOOM, dur: 30 });
  const scale = f >= inAt ? into : back.scale;
  const opacity = back.opacity * (1 - ramp(f, inAt + 12, 18));
  const focus = f >= inAt ? OV.r : { x: 960, y: 650 };
  const nodes: Node[] = [
    { key: "pc1", kind: "laptop", at: OV.pc1, label: "PC1", sub: "10.1.1.2/24" },
    { key: "pc2", kind: "laptop", at: OV.pc2, label: "PC2", sub: "10.1.1.3/24" },
    { key: "sw", kind: "switch", at: OV.sw, label: "Cheseaux_SR1" },
    { key: "r", kind: "router", at: OV.r, label: "Cheseaux", sub: "Cisco IOL", o: ramp(f, r1.s, 18), color: C.sel, act: ramp(f, r2.s, 12) },
  ];
  const links: Edge[] = [
    { a: "pc1", b: "sw" },
    { a: "pc2", b: "sw" },
    { a: "r", b: "sw", p: ramp(f, r1.s + 20, 24), label: "e0/0" },
  ];
  const roles = [
    { t: "Serveur DHCP", d: "objectif 3", c: C.sel },
    { t: "Passerelle", d: "vers les autres réseaux, plus tard", c: C.varB },
  ];
  return (
    <AbsoluteFill>
      <Header title="Objectif 2 · Le routeur Cisco" tag={TAG} />
      <Camera focus={focus} scale={scale} opacity={opacity}>
        <div style={{ position: "absolute", left: 1150, top: 200, display: "flex", flexDirection: "column", gap: 16, fontFamily: SANS }}>
          {roles.map((r, i) => {
            const p = ramp(f, r2.s + 20 + i * 24, 16);
            return (
              <div key={r.t} style={{ opacity: p, transform: `translateX(${lerp(-30, 0, p)}px)`, padding: "14px 22px", borderRadius: 16, background: "rgba(18,28,58,0.9)", border: `1.5px solid ${r.c}`, width: 520 }}>
                <div style={{ color: r.c, fontSize: 28, fontWeight: 800 }}>{r.t}</div>
                <div style={{ color: C.dim, fontSize: 22 }}>{r.d}</div>
              </div>
            );
          })}
        </div>
        <Terminal
          f={f}
          x={90}
          y={200}
          w={640}
          title="Cheseaux — console"
          prompt=""
          lines={[
            { at: r3.s + 2, out: true, text: "Would you like to enter the initial" },
            { at: r3.s + 2, out: true, text: "configuration dialog? [yes/no]:" },
            { at: r3.s + 30, text: "no", prompt: "", color: C.sel },
          ]}
          rows={3}
          fontSize={20}
          opacity={ramp(f, r3.s, 14)}
        />
        <Svg>
          <Net f={f} nodes={nodes} links={links} />
          <Lens x={780} y={150} w={360} h={250} label="zoom : CLI Cisco" p={ramp(f, r4.s, 16)} />
        </Svg>
      </Camera>
    </AbsoluteFill>
  );
};

// ───────────────────────────── Zoom : CLI Cisco ─────────────────────────────
const MODES = [
  { p: "Router>", n: "Mode utilisateur", d: "consulter très peu", c: C.dim },
  { p: "Router#", n: "Mode privilégié", d: "enable · tout consulter", c: C.one },
  { p: "(config)#", n: "Configuration globale", d: "configure terminal", c: C.sel },
  { p: "(config-if)#", n: "Configuration d'interface", d: "interface ethernet0/0", c: C.varA },
];

const Cisco: React.FC = () => {
  const f = useCurrentFrame();
  const { c1, c2, c3, c4, c5, c6, c7, c8 } = useLines();
  const outAt = c8.e - 26;
  const cam = useDetailCam(outAt);
  const mode = f < c2.s ? 0 : f < c3.s ? 1 : f < c4.s ? 2 : f < c7.s ? 3 : 1;
  const term: TermLine[] = [
    { at: c1.s + 10, text: "", prompt: "Router>" },
    { at: c2.s + 4, text: "enable", prompt: "Router>" },
    { at: c3.s + 4, text: "configure terminal", prompt: "Router#" },
    { at: c3.s + c3.d * 0.5, text: "hostname Cheseaux", prompt: "Router(config)#" },
    { at: c4.s + 4, text: "interface ethernet0/0", prompt: "Cheseaux(config)#" },
    { at: c5.s + 4, text: "ip address 10.1.1.1 255.255.255.0", prompt: "Cheseaux(config-if)#" },
    { at: c6.s + 4, text: "no shutdown", prompt: "Cheseaux(config-if)#" },
    { at: c6.s + 34, out: true, text: "%LINK-3-UPDOWN: Interface Ethernet0/0, changed state to up", color: C.one },
    { at: c7.s + 4, text: "exit", prompt: "Cheseaux(config-if)#" },
    { at: c7.s + 20, text: "exit", prompt: "Cheseaux(config)#" },
    { at: c7.s + c7.d * 0.45, text: "show run", prompt: "Cheseaux#" },
  ];
  return (
    <AbsoluteFill>
      <Header title="Zoom · Les modes du CLI Cisco" tag={TAG} />
      <ZoomBadge path={["Vue d'ensemble", "routeur", "CLI Cisco"]} opacity={ramp(f, 4, 16)} />
      <Camera focus={{ x: 960, y: 540 }} scale={cam.scale} opacity={cam.opacity}>
        {MODES.map((m, i) => {
          const p = ramp(f, [c1.s, c2.s, c3.s, c4.s][i], 16);
          const on = mode === i;
          return (
            <div
              key={m.p}
              style={{
                position: "absolute",
                left: 90 + i * 34,
                top: 190 + i * 140,
                width: 620,
                opacity: p * (on ? 1 : 0.5),
                transform: `translateX(${lerp(-30, 0, p)}px) scale(${on ? 1.03 : 1})`,
                padding: "16px 22px",
                borderRadius: 18,
                background: "rgba(18,28,58,0.92)",
                border: `${on ? 3 : 1.5}px solid ${on ? m.c : C.line}`,
                fontFamily: SANS,
              }}
            >
              <div style={{ fontFamily: MONO, fontSize: 32, color: m.c, fontWeight: 700 }}>{m.p}</div>
              <div style={{ color: C.text, fontSize: 25, fontWeight: 700 }}>{m.n}</div>
              <div style={{ color: C.dim, fontSize: 21, fontFamily: MONO }}>{m.d}</div>
            </div>
          );
        })}
        <Terminal f={f} x={840} y={190} w={990} title="Cheseaux — console" prompt="" lines={term} rows={9} fontSize={22} />
        <Card x={840} y={640} w={990} p={ramp(f, c6.s + 10, 16) * (1 - ramp(f, c8.s, 12))} color={C.bad} title="Piège">
          Sans <M c={C.bad}>no shutdown</M>, l'interface reste éteinte : le ping vers 10.1.1.1 échoue.
        </Card>
        <Card x={840} y={640} w={990} p={ramp(f, c8.s + 6, 16)} color={C.sel} title="running-config = RAM">
          La configuration tapée est active tout de suite, mais <b>perdue au redémarrage</b> : voir l'objectif 5.
        </Card>
      </Camera>
    </AbsoluteFill>
  );
};

// ───────────────────────────── Objectif 3 : configurer DHCP ─────────────────────────────
const MINI = "translate(874 56) scale(0.6)";
const miniAt = (p: Pt): Pt => ({ x: 874 + p.x * 0.6, y: 56 + p.y * 0.6 });

const DhcpConf: React.FC = () => {
  const f = useCurrentFrame();
  const { d1, d2, d3, d4, d5, d6, d7, d8, d9 } = useLines();
  const inAt = d9.e - 30;
  const back = useOverviewCam(true);
  const scale = f >= inAt ? zoomScale(f, { inAt, max: ZOOM, dur: 30 }) : back.scale;
  const opacity = back.opacity * (1 - ramp(f, inAt + 12, 18));
  const focus = f >= inAt ? miniAt(OV.pc1) : miniAt(OV.r);
  const fixedGone = f >= d8.s + 30;
  const nodes: Node[] = [
    { key: "pc1", kind: "laptop", at: OV.pc1, label: "PC1", sub: fixedGone ? "DHCP…" : "10.1.1.2/24", subColor: fixedGone ? C.sel : undefined },
    { key: "pc2", kind: "laptop", at: OV.pc2, label: "PC2", sub: fixedGone ? "DHCP…" : "10.1.1.3/24", subColor: fixedGone ? C.sel : undefined },
    { key: "sw", kind: "switch", at: OV.sw, label: "Cheseaux_SR1" },
    { key: "r", kind: "router", at: OV.r, label: "Cheseaux", sub: "10.1.1.1", color: C.sel, act: ramp(f, d3.s, 12) * (1 - ramp(f, d8.s, 12)) },
  ];
  const rt: TermLine[] = [
    { at: d4.s + 4, text: "ip dhcp pool cheseaux_sr1", prompt: "Cheseaux(config)#" },
    { at: d5.s + 4, text: "network 10.1.1.0 255.255.255.0", prompt: "Cheseaux(dhcp-config)#" },
    { at: d6.s + 4, text: "default-router 10.1.1.1", prompt: "Cheseaux(dhcp-config)#" },
    { at: d7.s + 4, text: "lease 7", prompt: "Cheseaux(dhcp-config)#" },
  ];
  const pt: TermLine[] = [
    { at: d8.s + 4, text: "sudo ip address del 10.1.1.2/24 dev ens3" },
    { at: d8.s + d8.d * 0.45, text: "sudo nano /etc/network/interfaces" },
    { at: d8.s + d8.d * 0.7, out: true, text: "auto ens3" },
    { at: d8.s + d8.d * 0.7, out: true, text: "iface ens3 inet dhcp", color: C.sel },
    { at: d9.s + 4, text: "sudo systemctl restart networking" },
  ];
  const cfgP = ramp(f, d4.s, 16);
  return (
    <AbsoluteFill>
      <Header title="Objectif 3 · Configurer DHCP" tag={TAG} />
      <Camera focus={focus} scale={scale} opacity={opacity}>
        <Card x={90} y={200} w={900} p={ramp(f, d2.s, 16) * (1 - cfgP)} color={C.bad} title="Adresses fixes">
          À la main sur chaque machine : long, et deux PC peuvent recevoir <b>la même adresse</b>.
        </Card>
        <Card x={90} y={380} w={900} p={ramp(f, d3.s, 16) * (1 - cfgP)} color={C.sel} title="DHCP" big>
          Un <b>serveur</b> prête les adresses <b>à la demande</b>, sans doublon.
        </Card>
        <Terminal f={f} x={90} y={190} w={960} title="Cheseaux — configuration DHCP" prompt="" lines={rt} rows={4} fontSize={22} opacity={cfgP} />
        <Terminal f={f} x={90} y={500} w={960} title="PC1 et PC2 — passer en DHCP" prompt="labo@pc1:~$" lines={pt} rows={5} fontSize={22} opacity={ramp(f, d8.s, 16)} />
        <FieldCard
          x={1110}
          y={610}
          w={720}
          title="CE QUE CHAQUE CLIENT RECEVRA"
          f={f}
          opacity={ramp(f, d5.s, 16)}
          reveal={[d5.s + 10, d5.s + 30, d6.s + 10, d7.s + 10]}
          fields={[
            ["Adresse", "une libre de 10.1.1.0/24"],
            ["Masque", "255.255.255.0"],
            ["Passerelle", "10.1.1.1"],
            ["Bail", "7 jours (1 jour par défaut)"],
          ]}
        />
        <Svg>
          <g transform={MINI}>
            <Net f={f} nodes={nodes} links={[{ a: "pc1", b: "sw" }, { a: "pc2", b: "sw" }, { a: "r", b: "sw", label: "e0/0" }]}>
              <Packet f={f} start={d1.s + 20} from={OV.pc1} via={[OV.sw]} to={OV.r} label="echo request" color={NET.icmp} dur={44} />
              <Packet f={f} start={d1.s + 66} from={OV.r} via={[OV.sw]} to={OV.pc1} label="echo reply" color={C.varB} dur={44} />
              <Packet f={f} start={d1.s + 30} from={OV.pc2} via={[OV.sw]} to={OV.r} label="echo request" color={NET.icmp} dur={44} labelBelow />
            </Net>
            <Lens x={420} y={630} w={300} h={300} label="zoom : DHCP" p={ramp(f, d9.s + 20, 16)} />
          </g>
        </Svg>
      </Camera>
    </AbsoluteFill>
  );
};

// ───────────────────────────── Zoom : DHCP, DORA ─────────────────────────────
const ZD = { r: { x: 1440, y: 200 }, sw: { x: 1440, y: 390 }, pc1: { x: 1170, y: 510 }, pc2: { x: 1710, y: 510 } };

/** A broadcast through the switch: to the switch, then to every other port at once. */
const Flood: React.FC<{ f: number; start: number; from: "pc1" | "r"; label: string; color: string }> = ({ f, start, from, label, color }) => {
  const others = (["r", "pc1", "pc2"] as const).filter((k) => k !== from);
  return (
    <g>
      <Broadcast f={f} start={start} at={ZD[from]} color={color} radius={150} waves={2} every={12} />
      <Packet f={f} start={start + 6} from={ZD[from]} to={ZD.sw} label={label} color={color} dur={30} size={0.8} />
      <Broadcast f={f} start={start + 36} at={ZD.sw} color={color} radius={220} waves={2} every={12} />
      {others.map((k) => (
        <Packet key={k} f={f} start={start + 38} from={ZD.sw} to={ZD[k]} label={k === "pc2" ? "broadcast" : label} color={color} dur={30} size={0.8} labelBelow={k !== "r"} />
      ))}
    </g>
  );
};

const Dhcp: React.FC = () => {
  const f = useCurrentFrame();
  const { z1, z2, z3, z4, z5, z6, z7, z8, z9, z10, z11, z12, z13 } = useLines();
  const outAt = z13.e - 26;
  const cam = useDetailCam(outAt);
  const hi = f < z5.s ? 0 : f < z7.s ? 1 : f < z9.s ? 2 : f < z10.s ? 3 : null;
  const got = f >= z9.s + 70;
  const nodes: Node[] = [
    { key: "r", kind: "router", at: ZD.r, label: "Cheseaux", sub: "10.1.1.1", size: 90, color: C.sel, act: hi === 1 || hi === 3 ? 1 : 0 },
    { key: "sw", kind: "switch", at: ZD.sw, label: "switch", size: 90 },
    { key: "pc1", kind: "laptop", at: ZD.pc1, label: "PC1", sub: got ? "10.1.1.2" : "0.0.0.0", subColor: got ? C.one : C.bad, size: 90, act: hi === 0 || hi === 2 ? 1 : 0 },
    { key: "pc2", kind: "laptop", at: ZD.pc2, label: "PC2", sub: "pas serveur", size: 90, o: 0.85 },
  ];
  const win = (s: number, e: number) => ramp(f, s, 14) * (1 - ramp(f, e, 12));
  return (
    <AbsoluteFill>
      <Header title="Zoom · DHCP en quatre messages" tag={TAG} />
      <ZoomBadge path={["Vue d'ensemble", "PC1 rejoint le réseau", "DHCP"]} opacity={ramp(f, 4, 16)} />
      <Camera focus={{ x: 960, y: 540 }} scale={cam.scale} opacity={cam.opacity}>
        <Svg>
          <SeqDiagram
            f={f}
            x={210}
            y={170}
            w={640}
            gap={135}
            appear={ramp(f, z1.s, 18)}
            hi={hi}
            actors={[
              { label: "PC1 · client", sub: got ? "10.1.1.2" : "pas d'adresse", kind: "laptop" },
              { label: "Cheseaux · serveur", sub: "10.1.1.1", kind: "router" },
            ]}
            msgs={[
              { at: z2.s + 6, from: 0, to: 1, label: "DHCP Discover", sub: "0.0.0.0:68 → 255.255.255.255:67", broadcast: true, color: NET.dhcp },
              { at: z5.s + 6, from: 1, to: 0, label: "DHCP Offer", sub: "propose 10.1.1.2 · bail 7 j", broadcast: true, color: NET.dhcp },
              { at: z7.s + 6, from: 0, to: 1, label: "DHCP Request", sub: "je prends 10.1.1.2", broadcast: true, color: NET.dhcp },
              { at: z9.s + 6, from: 1, to: 0, label: "DHCP ACK", sub: "10.1.1.2 confirmée", broadcast: true, color: C.one },
            ]}
          />
          <g opacity={ramp(f, z1.s + 10, 18)}>
            <Net f={f} nodes={nodes} links={[{ a: "r", b: "sw" }, { a: "pc1", b: "sw" }, { a: "pc2", b: "sw" }]}>
              <Flood f={f} start={z2.s + 20} from="pc1" label="Discover" color={NET.dhcp} />
              <Flood f={f} start={z5.s + 20} from="r" label="Offer" color={NET.dhcp} />
              <Flood f={f} start={z7.s + 20} from="pc1" label="Request" color={NET.dhcp} />
              <Flood f={f} start={z9.s + 20} from="r" label="ACK" color={C.one} />
            </Net>
            <g opacity={ramp(f, z4.s + 4, 12) * (1 - ramp(f, z5.s, 12))}>
              <circle cx={ZD.pc2.x + 60} cy={ZD.pc2.y - 55} r={22} fill={C.bg0} stroke={C.bad} strokeWidth={3} />
              <path d={`M${ZD.pc2.x + 50} ${ZD.pc2.y - 65} l20 20 m0 -20 l-20 20`} stroke={C.bad} strokeWidth={4} strokeLinecap="round" />
              <text x={ZD.pc2.x} y={ZD.pc2.y - 95} textAnchor="middle" fontFamily={SANS} fontSize={22} fontWeight={700} fill={C.bad}>
                ignoré
              </text>
            </g>
          </g>
        </Svg>
        <FieldCard
          x={1060}
          y={650}
          w={780}
          title="DISCOVER · « y a-t-il un serveur DHCP ? »"
          opacity={win(z2.s + 10, z5.s)}
          fields={[
            ["Source", "0.0.0.0 : 68 (pas d'adresse)"],
            ["Destination", "255.255.255.255 : 67 (tous)"],
            ["Transaction", "n° 654"],
          ]}
        />
        <FieldCard
          x={1060}
          y={650}
          w={780}
          title="OFFER · « je te propose ceci »"
          opacity={win(z5.s + 10, z7.s)}
          fields={[
            ["Adresse", "10.1.1.2"],
            ["Masque · passerelle", "255.255.255.0 · 10.1.1.1"],
            ["Bail", "7 jours · transaction n° 654"],
          ]}
        />
        <FieldCard
          x={1060}
          y={650}
          w={780}
          title="REQUEST · « je prends celle-là »"
          opacity={win(z7.s + 10, z9.s)}
          fields={[
            ["Adresse voulue", "10.1.1.2"],
            ["Serveur choisi", "10.1.1.1"],
            ["Destination", "255.255.255.255 (tous les serveurs)"],
          ]}
        />
        <FieldCard
          x={1060}
          y={650}
          w={780}
          title="ACK · « c'est confirmé »"
          color={C.one}
          opacity={win(z9.s + 10, z10.s)}
          fields={[
            ["Adresse", "10.1.1.2 attribuée à PC1"],
            ["Bail", "7 jours, à renouveler"],
            ["Transaction", "n° 654"],
          ]}
        />
        <div style={{ position: "absolute", left: 1060, top: 650, width: 780, opacity: win(z10.s, z12.s), display: "flex", gap: 14, fontFamily: SANS }}>
          {["Discover", "Offer", "Request", "Ack"].map((w, i) => {
            const p = ramp(f, z10.s + i * 8, 14);
            return (
              <div key={w} style={{ flex: 1, opacity: p, padding: "12px 0", borderRadius: 16, textAlign: "center", background: "rgba(18,28,58,0.92)", border: `1.5px solid ${i === 3 ? C.one : C.sel}` }}>
                <div style={{ fontSize: 64, fontWeight: 900, color: i === 3 ? C.one : C.sel }}>{w[0]}</div>
                <div style={{ fontSize: 20, color: C.dim }}>{w}</div>
              </div>
            );
          })}
        </div>
        <Card x={1060} y={830} w={780} p={win(z11.s, z12.s)} color={C.varB}>
          UDP · client <M c={C.varB}>port 68</M> · serveur <M c={C.varB}>port 67</M>
        </Card>
        <Terminal
          f={f}
          x={1060}
          y={650}
          w={780}
          title="Wireshark : filtre « bootp »"
          prompt="labo@pc1:~$"
          lines={[
            { at: z12.s + 20, text: "sudo dhclient -r ens3" },
            { at: z12.s + z12.d * 0.55, text: "sudo dhclient ens3" },
          ]}
          rows={2}
          fontSize={22}
          opacity={ramp(f, z12.s, 14)}
        />
      </Camera>
    </AbsoluteFill>
  );
};

// ───────────────────────────── Objectif 5 : sauvegarder ─────────────────────────────
const Save: React.FC = () => {
  const f = useCurrentFrame();
  const { s1, s2, s3, s4 } = useLines();
  const cam = useOverviewCam(true);
  const nodes: Node[] = [
    { key: "pc1", kind: "laptop", at: OV.pc1, label: "PC1", sub: "10.1.1.2 · DHCP", subColor: C.one },
    { key: "pc2", kind: "laptop", at: OV.pc2, label: "PC2", sub: "10.1.1.3 · DHCP", subColor: C.one },
    { key: "sw", kind: "switch", at: OV.sw, label: "Cheseaux_SR1" },
    { key: "r", kind: "router", at: OV.r, label: "Cheseaux", sub: "10.1.1.1", color: C.sel, act: ramp(f, s2.s, 12) },
  ];
  const mem = [
    { t: "RAM", n: "running-config", d: "perdue à l'extinction", c: C.bad },
    { t: "NVRAM", n: "startup-config", d: "conservée au redémarrage", c: C.one },
  ];
  return (
    <AbsoluteFill>
      <Header title="Objectif 5 · Sauvegarder" tag={TAG} />
      <Camera focus={OV.pc1} scale={cam.scale} opacity={cam.opacity}>
        <div style={{ position: "absolute", left: 1160, top: 180, display: "flex", flexDirection: "column", gap: 14, fontFamily: SANS }}>
          {mem.map((m, i) => {
            const p = ramp(f, s3.s + i * 30, 16);
            return (
              <div key={m.t} style={{ opacity: p, transform: `translateX(${lerp(-30, 0, p)}px)`, display: "flex", alignItems: "center", gap: 18, width: 660, padding: "14px 22px", borderRadius: 16, background: "rgba(18,28,58,0.92)", border: `1.5px solid ${m.c}` }}>
                <div style={{ fontFamily: MONO, fontSize: 30, fontWeight: 800, color: m.c, width: 120 }}>{m.t}</div>
                <div>
                  <div style={{ fontFamily: MONO, fontSize: 24, color: C.text }}>{m.n}</div>
                  <div style={{ fontSize: 21, color: C.dim }}>{m.d}</div>
                </div>
              </div>
            );
          })}
          <div style={{ opacity: ramp(f, s4.s, 16), padding: "14px 22px", borderRadius: 16, background: "rgba(255,200,87,0.1)", border: `1.5px solid ${C.sel}`, color: C.text, fontSize: 24, width: 660 }}>
            Avant de fermer : <b style={{ color: C.sel }}>exporter la configuration</b> (manuel EVE-NG, section 3.2)
          </div>
        </div>
        <Svg>
          <Net f={f} nodes={nodes} links={[{ a: "pc1", b: "sw" }, { a: "pc2", b: "sw" }, { a: "r", b: "sw", label: "e0/0" }]}>
            <Packet f={f} start={s1.s + 24} from={OV.pc1} via={[OV.sw]} to={OV.r} label="echo request" color={NET.icmp} dur={44} />
            <Packet f={f} start={s1.s + 70} from={OV.r} via={[OV.sw]} to={OV.pc1} label="echo reply" color={C.varB} dur={44} />
          </Net>
        </Svg>
      </Camera>
    </AbsoluteFill>
  );
};

// ───────────────────────────── Objectif 6 : Netcat ─────────────────────────────
const ncNodes = (f: number, extra: Partial<Record<"pc1" | "pc2", Partial<Node>>> = {}): Node[] => [
  { key: "pc1", kind: "laptop", at: HZ.pc1, label: "PC1", sub: "10.1.1.2", ...extra.pc1 },
  { key: "sw", kind: "switch", at: HZ.sw, label: "switch" },
  { key: "pc2", kind: "laptop", at: HZ.pc2, label: "PC2", sub: "10.1.1.3", ...extra.pc2 },
];
const NC_LINKS: Edge[] = [
  { a: "pc1", b: "sw" },
  { a: "sw", b: "pc2" },
];

const PortBadge: React.FC<{ at: Pt; port: string; p: number; color?: string }> = ({ at, port, p, color = C.varB }) => (
  <g opacity={p} transform={`translate(${at.x + 80} ${at.y - 70})`}>
    <rect x={-10} y={-22} width={150} height={44} rx={22} fill={C.bg0} stroke={color} strokeWidth={2.5} />
    <circle cx={14} cy={0} r={7} fill={color} />
    <text x={30} y={1} dominantBaseline="central" fontFamily={MONO} fontWeight={700} fontSize={22} fill={color}>
      :{port}
    </text>
  </g>
);

const NcIntro: React.FC = () => {
  const f = useCurrentFrame();
  const { n1, n2, n3, n4 } = useLines();
  const inAt = n4.e - 30;
  const cam = useOverviewCam(false, inAt);
  const conn = ramp(f, n3.s + 50, 16);
  return (
    <AbsoluteFill>
      <Header title="Objectif 6 · Netcat" tag={TAG} />
      <Camera focus={HZ.pc2} scale={cam.scale} opacity={cam.opacity * ramp(f, 0, 12)}>
        <Card x={560} y={190} w={800} p={ramp(f, n1.s + 10, 16) * (1 - ramp(f, n2.s, 12))} color={C.varB} title="Le couteau suisse du réseau" big>
          Ouvrir une connexion entre deux machines, et y faire passer <b>ce qu'on tape</b>.
        </Card>
        <Terminal f={f} x={90} y={190} w={820} title="PC1 — client" prompt="labo@pc1:~$" lines={[{ at: n3.s + 4, text: "nc 10.1.1.3 7777" }]} rows={3} fontSize={22} opacity={ramp(f, n3.s, 14)} />
        <Terminal f={f} x={1010} y={190} w={820} title="PC2 — serveur" prompt="labo@pc2:~$" lines={[{ at: n2.s + 4, text: "nc -l -p 7777" }]} rows={3} fontSize={22} opacity={ramp(f, n2.s, 14)} />
        <Svg>
          <Net f={f} nodes={ncNodes(f, { pc2: { act: ramp(f, n2.s, 12) * (1 - ramp(f, n3.s, 12)) } })} links={NC_LINKS.map((l) => ({ ...l, active: conn }))}>
            <Packet f={f} start={n3.s + 14} from={HZ.pc1} via={[HZ.sw]} to={HZ.pc2} label="connexion TCP" color={NET.tcp} dur={40} />
          </Net>
          <PortBadge at={HZ.pc2} port="7777" p={ramp(f, n2.s + 24, 14)} />
          <Lens x={1290} y={520} w={320} h={260} label="zoom : le port" p={ramp(f, n4.s, 16)} color={C.varB} />
        </Svg>
      </Camera>
    </AbsoluteFill>
  );
};

// ───────────────────────────── Zoom : le port ─────────────────────────────
const PORTS = [
  { n: "22", app: "ssh", open: false },
  { n: "80", app: "Web", open: false },
  { n: "7777", app: "nc -l -p 7777", open: true },
];

const Port: React.FC = () => {
  const f = useCurrentFrame();
  const { q1, q2, q3, q4 } = useLines();
  const outAt = q4.e - 26;
  const cam = useDetailCam(outAt);
  const box = { x: 820, y: 200, w: 980, h: 620 };
  const doorY = (i: number) => box.y + 150 + i * 170;
  const toBox = packetAt(f, q1.s + 20, { x: 170, y: 510 }, { x: box.x - 10, y: 510 }, 50);
  const inPort = ramp(f, q2.s + 10, 40);
  const pktX = lerp(box.x - 10, box.x + 380, inPort);
  const pktY = lerp(510, doorY(2), Math.min(1, inPort * 2.2));
  return (
    <AbsoluteFill>
      <Header title="Zoom · Adresse IP et port" tag={TAG} />
      <ZoomBadge path={["Netcat", "PC2", "port"]} opacity={ramp(f, 4, 16)} color={C.varB} />
      <Camera focus={{ x: 960, y: 540 }} scale={cam.scale} opacity={cam.opacity}>
        <Svg>
          <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={30} fill={C.panel} fillOpacity={0.6} stroke={C.one} strokeWidth={3} />
          <text x={box.x + 40} y={box.y + 60} fontFamily={SANS} fontWeight={800} fontSize={36} fill={C.text}>
            PC2
          </text>
          <text x={box.x + 140} y={box.y + 60} fontFamily={MONO} fontSize={30} fill={C.one}>
            10.1.1.3
          </text>
          <text x={box.x + 40} y={box.y + 100} fontFamily={SANS} fontSize={22} fill={C.dim}>
            l'adresse IP désigne la machine
          </text>
          {PORTS.map((p, i) => {
            const y = doorY(i);
            const on = p.open && f >= q2.s;
            const show = ramp(f, q2.s + i * 8, 14);
            const dim = !p.open && f >= q3.s ? 1 : 0;
            return (
              <g key={p.n} opacity={show}>
                <rect x={box.x - 30} y={y - 40} width={60} height={80} rx={10} fill={on ? C.varB : C.bg0} fillOpacity={on ? 0.35 : 1} stroke={p.open ? C.varB : C.zero} strokeWidth={3} />
                <text x={box.x + 50} y={y + 9} fontFamily={MONO} fontWeight={700} fontSize={30} fill={p.open ? C.varB : C.zero}>
                  :{p.n}
                </text>
                <rect x={box.x + 470} y={y - 44} width={440} height={88} rx={16} fill={C.bg0} stroke={p.open ? C.varB : C.line} strokeWidth={2.5} strokeDasharray={p.open ? undefined : "8 8"} />
                <text x={box.x + 690} y={y + 2} textAnchor="middle" dominantBaseline="central" fontFamily={MONO} fontSize={26} fill={p.open ? C.text : C.zero}>
                  {p.open ? p.app : `${p.app} : personne`}
                </text>
                <path d={`M${box.x + 190} ${y} H${box.x + 460}`} stroke={p.open ? C.varB : C.line} strokeWidth={3} strokeDasharray={p.open ? undefined : "6 10"} />
                <text x={box.x + 325} y={y - 14} textAnchor="middle" fontFamily={SANS} fontSize={20} fill={C.bad} opacity={dim}>
                  fermé
                </text>
              </g>
            );
          })}
          {toBox && f < q2.s + 10 ? <Packet f={f} start={q1.s + 20} from={{ x: 170, y: 510 }} to={{ x: box.x - 10, y: 510 }} label="→ 10.1.1.3 : 7777" color={NET.tcp} dur={50} /> : null}
          {f >= q2.s + 10 && f < q3.s ? (
            <g transform={`translate(${pktX} ${pktY})`} filter="url(#glow)">
              <rect x={-24} y={-17} width={48} height={34} rx={6} fill={C.bg0} stroke={NET.tcp} strokeWidth={3} />
              <path d="M-24 -15 L0 4 L24 -15" fill="none" stroke={NET.tcp} strokeWidth={3} />
            </g>
          ) : null}
          <g opacity={ramp(f, q4.s, 16)}>
            <rect x={150} y={720} width={600} height={100} rx={18} fill={C.panel} stroke={NET.tcp} strokeWidth={2} />
            <text x={450} y={760} textAnchor="middle" fontFamily={SANS} fontWeight={800} fontSize={26} fill={NET.tcp}>
              TCP : une connexion
            </text>
            <text x={450} y={795} textAnchor="middle" fontFamily={SANS} fontSize={22} fill={C.dim}>
              tout arrive, et dans l'ordre
            </text>
          </g>
        </Svg>
        <Card x={150} y={260} w={600} p={ramp(f, q2.s + 30, 16)} color={C.varB} title="Port">
          Un numéro de <M c={C.varB}>0</M> à <M c={C.varB}>65 535</M> : il désigne le <b>programme</b> qui attend dans la machine.
        </Card>
      </Camera>
    </AbsoluteFill>
  );
};

// ───────────────────────────── Netcat : chat ─────────────────────────────
const Chat: React.FC = () => {
  const f = useCurrentFrame();
  const { h1, h2, h3 } = useLines();
  const back = useOverviewCam(true);
  const m1 = h1.s + 40;
  const m2 = h2.s + 20;
  const t1: TermLine[] = [
    { at: -100, text: "nc 10.1.1.3 7777" },
    { at: m1, text: "salut PC2 !", prompt: "" },
    { at: m2 + 70, out: true, text: "salut, bien reçu", color: C.varA },
    { at: h3.s + 20, out: true, text: "^C" },
  ];
  const t2: TermLine[] = [
    { at: -100, text: "nc -l -p 7777" },
    { at: m1 + 70, out: true, text: "salut PC2 !", color: C.one },
    { at: m2, text: "salut, bien reçu", prompt: "" },
    { at: h3.s + 24, out: true, text: "^C" },
  ];
  const closed = ramp(f, h3.s + 24, 14);
  return (
    <AbsoluteFill>
      <Header title="Netcat · Chatter" tag={TAG} />
      <Camera focus={HZ.pc2} scale={back.scale} opacity={back.opacity}>
        <Terminal f={f} x={90} y={190} w={820} title="PC1 — client" prompt="labo@pc1:~$" lines={t1} rows={4} fontSize={22} />
        <Terminal f={f} x={1010} y={190} w={820} title="PC2 — serveur" prompt="labo@pc2:~$" lines={t2} rows={4} fontSize={22} />
        <Svg>
          <Net f={f} nodes={ncNodes(f)} links={NC_LINKS.map((l) => ({ ...l, active: 1 - closed, dashed: closed > 0.5 }))}>
            <Packet f={f} start={m1 + 20} from={HZ.pc1} via={[HZ.sw]} to={HZ.pc2} label="salut PC2 !" color={C.one} dur={46} />
            <Packet f={f} start={m2 + 26} from={HZ.pc2} via={[HZ.sw]} to={HZ.pc1} label="salut, bien reçu" color={C.varA} dur={46} labelBelow />
          </Net>
          <PortBadge at={HZ.pc2} port="7777" p={1 - closed} />
        </Svg>
      </Camera>
    </AbsoluteFill>
  );
};

// ───────────────────────────── Netcat : fichier ─────────────────────────────
const FileScene: React.FC = () => {
  const f = useCurrentFrame();
  const { f1, f2, f3, f4, f5 } = useLines();
  const send = f4.s + 10;
  const pos = packetAt(f, send, HZ.pc1, HZ.pc2, 70, 120);
  const t1: TermLine[] = [
    { at: f3.s + 4, text: "cat fichierA.txt" },
    { at: f3.s + 34, out: true, text: "Bonjour depuis PC1 !", color: C.sel },
    { at: f3.s + f3.d * 0.4, text: "nc 10.1.1.3 7777 < fichierA.txt" },
  ];
  const t2: TermLine[] = [
    { at: f1.s + 4, text: "nc -l -p 7777 > fichierB.txt" },
    { at: f4.s + f4.d * 0.5, text: "cat fichierB.txt" },
    { at: f4.s + f4.d * 0.5 + 30, out: true, text: "Bonjour depuis PC1 !", color: C.sel },
  ];
  return (
    <AbsoluteFill>
      <Header title="Netcat · Transférer un fichier" tag={TAG} />
      <Terminal f={f} x={90} y={190} w={820} title="PC1 — envoie" prompt="labo@pc1:~$" lines={t1} rows={3} fontSize={22} />
      <Terminal f={f} x={1010} y={190} w={820} title="PC2 — reçoit" prompt="labo@pc2:~$" lines={t2} rows={3} fontSize={22} />
      <Card x={1010} y={790} w={820} p={ramp(f, f2.s, 16)} color={C.sel}>
        <M>&gt; fichierB.txt</M> : ce que Netcat reçoit est <b>écrit dans le fichier</b>
      </Card>
      <Card x={90} y={790} w={820} p={ramp(f, f3.s + f3.d * 0.5, 16)} color={C.sel}>
        <M>&lt; fichierA.txt</M> : le fichier devient <b>ce que Netcat envoie</b>
      </Card>
      <Card x={560} y={430} w={800} p={ramp(f, f5.s, 16)} color={C.one} big>
        N'importe quel fichier : texte, <b>photo</b>, <b>programme</b>…
      </Card>
      <Svg>
        <Net f={f} nodes={ncNodes(f)} links={NC_LINKS.map((l) => ({ ...l, active: ramp(f, send, 10) * (1 - ramp(f, send + 80, 10)) }))} />
        <FileIcon x={HZ.pc1.x - 120} y={HZ.pc1.y - 20} name="fichierA.txt" opacity={ramp(f, f3.s, 16)} />
        {pos ? <FileIcon x={pos.x} y={pos.y - 60} name="" scale={1.1} opacity={1} /> : null}
        <FileIcon x={HZ.pc2.x + 120} y={HZ.pc2.y - 20} name="fichierB.txt" opacity={ramp(f, f1.s + 40, 16)} color={f >= send + 70 ? C.sel : C.zero} />
      </Svg>
    </AbsoluteFill>
  );
};

// ───────────────────────────── Netcat : serveur Web ─────────────────────────────
const WZ = { ub: { x: 480, y: 660 }, sw: { x: 960, y: 660 }, pc2: { x: 1440, y: 660 } };
const CMD = [
  { t: "while true; do ", c: C.varB },
  { t: "{ echo -e 'HTTP/1.1 200 OK\\r\\n'; echo Heure à Yverdon; date; }", c: C.sel },
  { t: " | sudo nc -l -p 80", c: C.varA },
  { t: "; done", c: C.varB },
];

const Browser: React.FC<{ x: number; y: number; w: number; url: string; time: string; p: number; loaded: number }> = ({ x, y, w, url, time, p, loaded }) => (
  <div style={{ position: "absolute", left: x, top: y, width: w, opacity: p, borderRadius: 14, overflow: "hidden", border: `1.5px solid ${C.line}`, background: "#f4f6fb", fontFamily: SANS }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", background: "#dfe4ef" }}>
      {["#ff6b6b", "#ffc857", "#3fe0c5"].map((c) => (
        <div key={c} style={{ width: 11, height: 11, borderRadius: 6, background: c }} />
      ))}
      <div style={{ marginLeft: 10, flex: 1, padding: "4px 12px", borderRadius: 8, background: "#fff", fontFamily: MONO, fontSize: 19, color: "#333" }}>{url}</div>
    </div>
    <div style={{ padding: "16px 20px", minHeight: 90, color: "#111", fontSize: 24, opacity: loaded }}>
      Heure à Yverdon
      <br />
      <span style={{ fontFamily: MONO, fontSize: 21 }}>{time}</span>
    </div>
  </div>
);

const Web: React.FC = () => {
  const f = useCurrentFrame();
  const { w1, w2, w3, w4, w5, w6, w7 } = useLines();
  const seg = f < w2.s ? -1 : f < w3.s ? 0 : f < w4.s ? 1 : f < w5.s ? 2 : -1;
  const get1 = w6.s + 10;
  const get2 = w7.s + w7.d * 0.35;
  const loaded = ramp(f, get1 + 100, 12);
  const time = f >= get2 + 100 ? "Thu Nov 12 18:42:19 CET 2026" : "Thu Nov 12 18:42:07 CET 2026";
  const nodes: Node[] = [
    { key: "ub", kind: "browser", at: WZ.ub, label: "Ubuntu", sub: "Firefox", o: ramp(f, w1.s, 16), color: C.varA },
    { key: "sw", kind: "switch", at: WZ.sw, label: "switch" },
    { key: "pc2", kind: "laptop", at: WZ.pc2, label: "PC2", sub: "10.1.1.3 · port 80", act: ramp(f, w4.s, 12) },
  ];
  return (
    <AbsoluteFill>
      <Header title="Netcat · Un serveur Web en une ligne" tag={TAG} />
      <div style={{ position: "absolute", left: 90, top: 185, width: 1740, opacity: ramp(f, w2.s, 16), padding: "16px 22px", borderRadius: 16, background: "rgba(5,8,18,0.94)", border: `1.5px solid ${C.line}`, fontFamily: MONO, fontSize: 21, whiteSpace: "nowrap" }}>
        <span style={{ color: C.one }}>labo@pc2:~$ </span>
        {CMD.map((s, i) => {
          const on = seg === i || (seg === 0 && i === 3);
          return (
            <span key={i} style={{ color: seg === -1 || on ? s.c : C.zero, background: on ? `${s.c}22` : undefined, borderRadius: 6 }}>
              {s.t}
            </span>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 90, top: 270, display: "flex", gap: 16, fontFamily: SANS, fontSize: 22 }}>
        {[
          { t: "boucle sans fin", c: C.varB, at: w2.s },
          { t: "fabrique la réponse HTTP", c: C.sel, at: w3.s },
          { t: "l'envoie au client, port 80 (sudo : port < 1024)", c: C.varA, at: w4.s },
        ].map((b) => (
          <div key={b.t} style={{ opacity: ramp(f, b.at + 6, 14), padding: "8px 16px", borderRadius: 12, border: `1.5px solid ${b.c}`, color: b.c, background: "rgba(18,28,58,0.9)" }}>
            {b.t}
          </div>
        ))}
      </div>
      <div style={{ position: "absolute", left: 1250, top: 350, width: 580, opacity: ramp(f, w3.s + 30, 16), padding: "14px 20px", borderRadius: 14, background: "rgba(18,28,58,0.92)", border: `1.5px solid ${C.sel}`, fontFamily: MONO, fontSize: 20, lineHeight: 1.45, color: C.text }}>
        <div style={{ color: C.sel }}>HTTP/1.1 200 OK</div>
        <div style={{ color: C.dim }}>(ligne vide)</div>
        <div>Heure à Yverdon</div>
        <div>Thu Nov 12 18:42:07 CET 2026</div>
      </div>
      <Browser x={90} y={360} w={640} url="http://10.1.1.3" time={time} p={ramp(f, w5.s, 16)} loaded={loaded} />
      <Svg>
        <Net f={f} nodes={nodes} links={[{ a: "ub", b: "sw", p: ramp(f, w1.s + 12, 20) }, { a: "sw", b: "pc2" }]}>
          {[get1, get2].map((s, i) => (
            <g key={i}>
              <Packet f={f} start={s} from={WZ.ub} via={[WZ.sw]} to={WZ.pc2} label="GET /" color={NET.http} dur={44} />
              <Packet f={f} start={s + 52} from={WZ.pc2} via={[WZ.sw]} to={WZ.ub} label="200 OK + page" color={C.sel} dur={44} labelBelow />
            </g>
          ))}
        </Net>
        <PortBadge at={WZ.pc2} port="80" p={ramp(f, w4.s + 20, 14)} color={C.varA} />
        <g opacity={ramp(f, w7.s + 10, 14)}>
          <text x={WZ.pc2.x} y={WZ.pc2.y + 150} textAnchor="middle" fontFamily={SANS} fontSize={22} fill={C.varB}>
            ↻ la boucle relance nc après chaque connexion
          </text>
        </g>
      </Svg>
    </AbsoluteFill>
  );
};

// ───────────────────────────── Netcat : client HTTP vers Google ─────────────────────────────
const GZ = { ub: { x: 420, y: 580 }, cloud: { x: 960, y: 580 }, g: { x: 1500, y: 580 } };

const Google: React.FC = () => {
  const f = useCurrentFrame();
  const { g1, g2, g3, g4, g5, g6 } = useLines();
  const send = g4.e - 10;
  const term: TermLine[] = [
    { at: g3.s + 4, text: "nc www.google.ch 80", prompt: "eve@ubuntu:~$" },
    { at: g4.s + 10, text: "GET / HTTP/1.1", prompt: "", color: C.varA },
    { at: g4.s + g4.d * 0.75, text: "", prompt: "" },
    { at: g5.s + 30, out: true, text: "HTTP/1.1 200 OK", color: C.one },
    { at: g5.s + 36, out: true, text: "Content-Type: text/html; charset=ISO-8859-1" },
    { at: g5.s + 42, out: true, text: '<!doctype html><html itemscope="" lang="fr-CH"><head>…<title>Google</title>…' },
  ];
  const nodes: Node[] = [
    { key: "ub", kind: "browser", at: GZ.ub, label: "Ubuntu", sub: "10.190.139.x", color: C.varA },
    { key: "cloud", kind: "cloud", at: GZ.cloud, label: "Management (Cloud0)", sub: "vers Internet", color: C.varB, o: ramp(f, g1.s + 20, 16) },
    { key: "g", kind: "server", at: GZ.g, label: "www.google.ch", sub: "port 80", o: ramp(f, g3.s, 16), color: C.sel },
  ];
  return (
    <AbsoluteFill>
      <Header title="Netcat · Jouer le navigateur" tag={TAG} />
      <Terminal f={f} x={90} y={185} w={1740} title="Ubuntu — terminal" prompt="eve@ubuntu:~$" lines={term} rows={6} fontSize={22} opacity={ramp(f, g3.s, 14)} />
      <FieldCard
        x={90}
        y={700}
        w={820}
        title="CONFIGURATION FIXE D'UBUNTU"
        color={C.varB}
        opacity={ramp(f, g2.s, 16)}
        f={f}
        reveal={[g2.s + 10, g2.s + 22, g2.s + g2.d * 0.45, g2.s + g2.d * 0.7]}
        fields={[
          ["IP", "10.190.139.(VM + 100)"],
          ["Masque", "255.255.255.0"],
          ["Passerelle", "10.190.139.1"],
          ["DNS", "10.193.64.16 · 10.193.56.16"],
        ]}
      />
      <Card x={1010} y={720} w={820} p={ramp(f, g6.s, 16)} color={C.one} big>
        HTTP est du <b style={{ color: C.one }}>texte clair</b> : on peut le taper soi-même.
      </Card>
      <Svg>
        <Net f={f} nodes={nodes} links={[{ a: "ub", b: "cloud", p: ramp(f, g1.s + 30, 20) }, { a: "cloud", b: "g", p: ramp(f, g3.s + 10, 20), dashed: true }]}>
          <Packet f={f} start={g3.s + 30} from={GZ.ub} via={[GZ.cloud]} to={GZ.g} label="connexion TCP" color={NET.tcp} dur={44} />
          <Packet f={f} start={send} from={GZ.ub} via={[GZ.cloud]} to={GZ.g} label="GET / HTTP/1.1" color={NET.http} dur={44} />
          <Packet f={f} start={g5.s} from={GZ.g} via={[GZ.cloud]} to={GZ.ub} label="200 OK + HTML" color={C.one} dur={44} labelBelow />
        </Net>
      </Svg>
    </AbsoluteFill>
  );
};

// ───────────────────────────── Récap ─────────────────────────────
const Recap: React.FC = () => {
  const f = useCurrentFrame();
  const { x2, x3, x4, x5, x6 } = useLines();
  const items = [
    { t: "Switch, IP fixe, ping", d: "sudo ip address add 10.1.1.2/24 dev ens3 · ping 10.1.1.3", at: x2.s, c: C.one },
    { t: "Routeur Cisco", d: "enable · configure terminal · interface · ip address · no shutdown", at: x3.s, c: C.sel },
    { t: "DHCP = DORA", d: "Discover · Offer · Request · Ack, en broadcast (pas encore d'adresse)", at: x4.s, c: C.sel },
    { t: "Sauvegarder", d: "running-config en RAM : exporter avant de fermer", at: x5.s, c: C.bad },
    { t: "Netcat", d: "nc -l -p PORT (serveur) · nc ADRESSE PORT (client) · > et < · HTTP à la main", at: x6.s, c: C.varB },
  ];
  return (
    <AbsoluteFill>
      <Header title="À retenir" tag={TAG} />
      <div style={{ position: "absolute", left: 90, top: 190, display: "flex", flexDirection: "column", gap: 16, fontFamily: SANS }}>
        {items.map((it, i) => {
          const p = ramp(f, it.at, 18);
          return (
            <div key={it.t} style={{ opacity: p, transform: `translateX(${lerp(-40, 0, p)}px)`, display: "flex", alignItems: "center", gap: 24, width: 1500, padding: "16px 26px", borderRadius: 20, background: "rgba(18,28,58,0.88)", border: `1px solid ${C.line}` }}>
              <div style={{ width: 58, height: 58, borderRadius: 16, background: it.c, color: C.bg0, fontSize: 32, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</div>
              <div>
                <div style={{ color: C.text, fontSize: 32, fontWeight: 700 }}>{it.t}</div>
                <div style={{ color: C.dim, fontSize: 22, fontFamily: MONO, marginTop: 4 }}>{it.d}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", right: 90, top: 80, opacity: ramp(f, useScene().dur - 70, 18), fontFamily: SANS, fontSize: 44, fontWeight: 800, color: C.one }}>À toi de jouer dans EVE-NG.</div>
    </AbsoluteFill>
  );
};

export const scenes = {
  intro: Intro,
  lan: Lan,
  ping: Ping,
  router: Router,
  cisco: Cisco,
  dhcpconf: DhcpConf,
  dhcp: Dhcp,
  save: Save,
  ncintro: NcIntro,
  port: Port,
  chat: Chat,
  file: FileScene,
  web: Web,
  google: Google,
  recap: Recap,
};
