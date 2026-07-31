import { Ds2Address } from "@tsunagi/ds2-core";
import { MMark } from "@/components/MMark";

const hex = (n: number) => `0x${n.toString(16).toUpperCase()}`;

// Scaffold shell. The real four-view instrument (診断 / データログ /
// キャリブレーション / アクチュエータテスト) lands once packages/ds2-core is
// extracted — see the plan, §2 then §6. This page exists so the theme, the
// fonts and the static export are verifiable now rather than at the end.
export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-8 p-8">
      <header className="flex flex-col items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center">
          E46M3
          <MMark className="mx-2" />
          DIAGNOSIS
        </h1>
        <p className="text-xs uppercase tracking-widest text-slate-500">
          DS2 / K-line · MSS54 · SMG II · DSC
        </p>
      </header>

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-slate-500 uppercase text-[11px] tracking-widest self-center">
          Transport
        </dt>
        <dd className="font-mono text-slate-200">Web Serial · 9600 8E1</dd>

        <dt className="text-slate-500 uppercase text-[11px] tracking-widest self-center">
          Addresses
        </dt>
        <dd className="font-mono text-slate-200">
          {[Ds2Address.DME, Ds2Address.SMG, Ds2Address.DSC].map(hex).join(" · ")}
        </dd>

        <dt className="text-slate-500 uppercase text-[11px] tracking-widest self-center">
          Status
        </dt>
        <dd className="font-mono text-amber-400">SCAFFOLD — no link yet</dd>
      </dl>
    </main>
  );
}
