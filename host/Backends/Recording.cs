using System.Text.Json;

namespace OldBmwDiagHost.Backends;

/// <summary>
/// 実車セッションの記録（ホストレベル）。実車で1回記録し、以後どこでもオフライン再生する。
/// ＝ Tool32 のシミュレーションと同じ狙い（ハード無しで実データを使った開発/テスト）。
/// 記録内容: 識別・故障・ライブ値(最新値＋実単位)・ジョブ応答。
/// </summary>
public sealed class LiveCell
{
    public object? value { get; set; }
    public string unit { get; set; } = "";
}

public sealed class Recording
{
    public string ecu { get; set; } = "";
    public string? sgbd { get; set; }
    public string recordedAt { get; set; } = "";
    public string sourceBackend { get; set; } = "";
    public IdentResult? ident { get; set; }
    public FaultResult? faults { get; set; }
    public Dictionary<string, LiveCell> live { get; set; } = new();
    public Dictionary<string, JobResult> jobs { get; set; } = new();

    public static readonly JsonSerializerOptions Opts = new()
    {
        WriteIndented = true,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public void Save(string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        File.WriteAllText(path, JsonSerializer.Serialize(this, Opts));
    }

    public static Recording Load(string path)
        => JsonSerializer.Deserialize<Recording>(File.ReadAllText(path)) ?? new Recording();
}
