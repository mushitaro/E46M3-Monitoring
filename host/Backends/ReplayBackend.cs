using System.Text.Json;

namespace OldBmwDiagHost.Backends;

/// <summary>
/// 再生バックエンド。実車で記録した Recording を読み、ハード無し・EdiabasLib無しで
/// 実データを返す（net9 の mock ホストで動く）。開発/テスト/デモに使う。
///   例)  dotnet run -c Release -- --backend replay --recording recordings\m3.json
/// ライブ値は数値に微小ジッタを与えて“生きている”表示にする。
/// </summary>
public sealed class ReplayBackend : IDiagBackend
{
    private readonly string _ecuDataDir;
    private readonly Recording _rec;
    private readonly Random _rnd = new();
    public string Name => "replay";
    public string? CurrentEcu { get; private set; }

    public ReplayBackend(string ecuDataDir, string recPath)
    {
        _ecuDataDir = ecuDataDir;
        _rec = Recording.Load(recPath);
        CurrentEcu = _rec.ecu;
    }

    public object ListEcus()
        => JsonSerializer.Deserialize<object>(File.ReadAllText(Path.Combine(_ecuDataDir, "index.json")))!;

    public void Connect(string ecuId, string? iface) { CurrentEcu = ecuId; }

    public IdentResult ReadIdent()
        => _rec.ident ?? new IdentResult("—", "—", "—", "—", "replay(記録なし)");

    public FaultResult ReadFaults()
        => _rec.faults ?? new FaultResult(false, new List<FaultEntry>());

    public LiveResult ReadLive(string[] ids)
    {
        var values = new Dictionary<string, object?>();
        var units = new Dictionary<string, string>();
        foreach (var id in ids)
        {
            if (!_rec.live.TryGetValue(id, out var cell)) continue;
            values[id] = Jitter(Unwrap(cell.value));
            if (!string.IsNullOrEmpty(cell.unit)) units[id] = cell.unit;
        }
        return new LiveResult(values, units);
    }

    public JobResult RunJob(string job, string[]? args)
    {
        string key = job + "|" + (args != null ? string.Join(",", args) : "");
        if (_rec.jobs.TryGetValue(key, out var r)) return r;
        return new JobResult(true, "OKAY (replay)");
    }

    // 記録値は再ロードで JsonElement になる → 素の値へ
    private static object? Unwrap(object? o)
    {
        if (o is JsonElement je)
            return je.ValueKind switch
            {
                JsonValueKind.Number => je.TryGetInt64(out long l) ? l : je.GetDouble(),
                JsonValueKind.String => je.GetString(),
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                _ => je.ToString(),
            };
        return o;
    }

    // 数値だけ微小に揺らす（UIが動いて見えるように）。整数/文字列はそのまま。
    private object? Jitter(object? v)
    {
        if (v is double d) return Math.Round(d * (1 + (_rnd.NextDouble() * 2 - 1) * 0.01), 2);
        return v;
    }
}
