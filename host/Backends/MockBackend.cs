using System.Text.Json;

namespace OldBmwDiagHost.Backends;

/// <summary>
/// ハードウェア不要の mock。ecu-data/*.json（実SGBD由来の名称・故障本文）を読み、
/// ライブ値は名称ヒューリスティックで合成する。PWA↔ホストの全経路検証用。
/// </summary>
public sealed class MockBackend : IDiagBackend
{
    private readonly string _dir;
    private readonly long _t0 = Environment.TickCount64;
    private JsonElement _index;
    private JsonElement _ecu;
    public string Name => "mock";
    public string? CurrentEcu { get; private set; }

    public MockBackend(string ecuDataDir)
    {
        _dir = ecuDataDir;
        _index = JsonDocument.Parse(File.ReadAllText(Path.Combine(_dir, "index.json"))).RootElement.Clone();
    }

    public object ListEcus() => JsonSerializer.Deserialize<object>(_index.GetRawText())!;

    public void Connect(string ecuId, string? iface)
    {
        var path = Path.Combine(_dir, ecuId + ".json");
        if (!File.Exists(path)) throw new FileNotFoundException($"ECU プロファイルなし: {ecuId}");
        _ecu = JsonDocument.Parse(File.ReadAllText(path)).RootElement.Clone();
        CurrentEcu = ecuId;
    }

    public IdentResult ReadIdent()
    {
        EnsureEcu();
        var sgbd = _ecu.GetProperty("sgbd").GetString() ?? "";
        return new IdentResult("7831387", "14", "041", "2703", $"mock / {sgbd}");
    }

    public FaultResult ReadFaults()
    {
        EnsureEcu();
        // faultText は現在バイリンガル {de,ja,en}。ja(無ければde)を採用。旧・文字列形式にも耐性。
        var texts = new List<string>();
        if (_ecu.TryGetProperty("faultText", out var ft) && ft.ValueKind == JsonValueKind.Array)
            foreach (var e in ft.EnumerateArray())
            {
                string s = e.ValueKind == JsonValueKind.Object
                    ? (e.TryGetProperty("ja", out var j) ? j.GetString() ?? ""
                        : e.TryGetProperty("de", out var de) ? de.GetString() ?? "" : "")
                    : e.GetString() ?? "";
                if (s.Length > 0) texts.Add(s);
            }
        var faults = new List<FaultEntry>();
        int[] pick = { 3, 11, 23, 40 };
        var seen = new HashSet<int>();
        for (int k = 0; k < pick.Length && texts.Count > 0; k++)
        {
            int i = pick[k] % texts.Count;
            if (!seen.Add(i)) continue;
            faults.Add(new FaultEntry(
                code: "0x" + (0x2000 + i).ToString("X4"),
                desc: texts[i], present: k == 0, sporadic: k > 1,
                raw: $"{(0x20 + (i >> 8)) & 0xff:x2} {i & 0xff:x2} {(k == 0 ? 0x08 : 0x02):x2}"));
        }
        return new FaultResult(faults.Count > 0, faults);
    }

    public LiveResult ReadLive(string[] ids)
    {
        EnsureEcu();
        double t = Environment.TickCount64 - _t0;
        var rnd = Random.Shared;
        var outp = new Dictionary<string, object?>();
        foreach (var id in ids) outp[id] = Synth(id, t, rnd);
        // mock は実単位を持たない（実単位はECUが _EINH で返すため実機のみ）→ 空
        return new LiveResult(outp, new Dictionary<string, string>());
    }

    public JobResult RunJob(string job, string[]? args)
        => new JobResult(true, "OKAY", new() { ["_note"] = "mock: 実行を模擬（実機は EdiabasLib バックエンド）" });

    // 名称ヒューリスティックで“それらしい”値を返す（PWA の classify と整合）
    private static object Synth(string id, double t, Random r)
    {
        double j(double a) => (r.NextDouble() * 2 - 1) * a;
        double sin(double p) => Math.Sin(t / p);
        string n = id.ToUpperInvariant();
        double warm(double tgt) => Math.Min(tgt, 22 + (tgt - 22) * (1 - Math.Exp(-t / 90000)));
        if (n.Contains("DREHZAHL")) return Math.Round(1050 + 40 * sin(900) + j(20));
        if (n.Contains("GESCHWIND")) return 0;
        if (n.Contains("OEL") && n.Contains("TEMP")) return Math.Round(warm(102) + j(0.5), 1);
        if (n.Contains("TEMP")) return Math.Round(warm(95) + j(0.4), 1);
        if (n.Contains("SPANNUNG") || n.Contains("UBATT")) return Math.Round(13.9 + 0.15 * sin(2500) + j(0.05), 1);
        if (n.Contains("LAMBDA")) return Math.Round(1.0 + 0.03 * sin(300) + j(0.006), 3);
        if (n.Contains("VANOS") || n.Contains("WINKEL") || n.Contains("POSITION")) return Math.Round(10 + 5 * sin(700) + j(0.5), 1);
        if (n.Contains("DRUCK")) return Math.Round(3 + j(0.1), 2);
        if (n.Contains("GANG")) return 0;
        return Math.Round(10 + j(3), 1);
    }

    private void EnsureEcu()
    {
        if (CurrentEcu == null) throw new InvalidOperationException("未接続: /api/connect を先に呼んでください");
    }
}
