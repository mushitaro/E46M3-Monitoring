#if EDIABASLIB
using EdiabasLib;
#endif

namespace OldBmwDiagHost.Backends;

/// <summary>
/// 実機バックエンド（EdiabasLib）。EdiabasLib は元 EDIABAS の .NET 再実装で、
/// 元の SGBD(.prg) をそのまま読み、DS2/KWP/K-Line を喋り、正しいスケーリングと
/// 故障本文を返す。＝「Phase 2」の本体。API は EdiabasLib/EdiabasTest の正準パターンに準拠。
///
/// 有効化（実車で使うとき）:
///   1) git clone https://github.com/uholeschak/ediabaslib   （C:\EC-APPS\ediabaslib）
///   2) OldBmwDiagHost.csproj に EdiabasLib 参照と DefineConstants=EDIABASLIB を追加
///      （csproj のコメント参照。TFM は net8.0-windows 等に合わせる）
///   3) EcuPath（SGBD フォルダ）と COM ポートを環境に合わせる
///   4) host\run-host.bat ediabas で起動 → 実車で読取値・故障本文・スケーリングを検証
///
/// ※ EdiabasLib 未参照のビルドでは Connect 時に明示エラー（mock を使う）。
/// </summary>
public sealed class EdiabasLibBackend : IDiagBackend
{
    private readonly string _ecuDataDir;
    private string _ecuPath = @"C:\EDIABAS\ECU";   // 実 SGBD(.prg) の場所
    public string Name => "ediabas";
    public string? CurrentEcu { get; private set; }

    public EdiabasLibBackend(string ecuDataDir) { _ecuDataDir = ecuDataDir; }

    public object ListEcus()
        => System.Text.Json.JsonSerializer.Deserialize<object>(
            File.ReadAllText(Path.Combine(_ecuDataDir, "index.json")))!;

#if EDIABASLIB
    // ---- 実結線（EdiabasLib の EdiabasNet 管理API, EdiabasTest 準拠） ---------
    private EdiabasNet? _ediabas;
    private string _sgbd = "";
    // result id -> それを返すジョブ / 単位結果名（ecu-data の権威データ由来）
    private readonly Dictionary<string, string> _paramJob = new();
    private readonly Dictionary<string, string> _paramUnit = new();

    public void Connect(string ecuId, string? iface)
    {
        var json = System.Text.Json.JsonDocument.Parse(
            File.ReadAllText(Path.Combine(_ecuDataDir, ecuId + ".json"))).RootElement;
        _sgbd = Path.GetFileNameWithoutExtension(json.GetProperty("sgbd").GetString() ?? "") ?? "";

        // 権威データから result→job / result→unit の対応表を作る（実機読取に必須）
        _paramJob.Clear(); _paramUnit.Clear();
        foreach (var g in json.GetProperty("groups").EnumerateArray())
            foreach (var p in g.GetProperty("params").EnumerateArray())
            {
                string id = p.GetProperty("id").GetString() ?? "";
                if (id.Length == 0) continue;
                if (p.TryGetProperty("job", out var jb)) _paramJob[id] = jb.GetString() ?? "";
                if (p.TryGetProperty("unitRes", out var ur)) _paramUnit[id] = ur.GetString() ?? "";
            }

        _ediabas?.Dispose();
        _ediabas = new EdiabasNet(string.Empty);
        // ComPort は実COMポート名（例 "COM3"）または FTDI直アクセス（"FTDI0"）。
        // ※ "STD:OBD" はEDIABASのインターフェース名でありComPort値ではない（誤り修正済み）。
        var obd = new EdInterfaceObd { ComPort = ResolveComPort(iface) };  // K-Line/DS2（K+DCANケーブル）
        _ediabas.EdInterfaceClass = obd;
        _ediabas.SetConfigProperty("EcuPath", _ecuPath);
        // 診断用: EDIABAS_TRACE=1..3 でIFH/APIトレースを host\trace に出力（IFH-0018等の切り分け）
        var tr = Environment.GetEnvironmentVariable("EDIABAS_TRACE");
        if (!string.IsNullOrWhiteSpace(tr))
        {
            var traceDir = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "trace");
            Directory.CreateDirectory(traceDir);
            _ediabas.SetConfigProperty("IfhTrace", tr);
            _ediabas.SetConfigProperty("ApiTrace", tr);
            _ediabas.SetConfigProperty("TracePath", Path.GetFullPath(traceDir));
            _ediabas.SetConfigProperty("AppendTrace", "0");
        }
        _ediabas.ResolveSgbdFile(_sgbd);                                 // SGBD を読み込む
        CurrentEcu = ecuId;
    }

    // COMポート解決: 環境変数 EDIABAS_COMPORT 優先 → PWAが "COMx"/"FTDIx" を送ればそれ → 既定 COM3
    private static string ResolveComPort(string? iface)
    {
        var env = Environment.GetEnvironmentVariable("EDIABAS_COMPORT");
        if (!string.IsNullOrWhiteSpace(env)) return env.Trim();
        if (!string.IsNullOrWhiteSpace(iface))
        {
            var up = iface.Trim().ToUpperInvariant();
            if (up.StartsWith("COM") || up.StartsWith("FTDI")) return iface.Trim();
        }
        return "COM3";   // 環境依存。EDIABAS_COMPORT で上書きすること（手順書参照）
    }

    private List<Dictionary<string, EdiabasNet.ResultData>> Run(string job, string arg = "", string results = "")
    {
        _ediabas!.ArgString = arg;
        _ediabas.ResultsRequests = results;
        _ediabas.ExecuteJob(job);
        return _ediabas.ResultSets;
    }
    private static string Str(List<Dictionary<string, EdiabasNet.ResultData>> rs, int set, string key)
        => rs.Count > set && rs[set].TryGetValue(key, out EdiabasNet.ResultData? v) && v != null ? v.OpData?.ToString() ?? "" : "";

    public IdentResult ReadIdent()
    {
        var rs = Run("IDENT");
        return new IdentResult(Str(rs, 1, "ID_BMW_NR"), Str(rs, 1, "ID_HW_NR"),
            Str(rs, 1, "ID_SW_NR"), Str(rs, 1, "ID_DATUM"), _sgbd);
    }

    public FaultResult ReadFaults()
    {
        var rs = Run("FS_LESEN");                       // 故障読取（本文は SGBD が返す）
        var faults = new List<FaultEntry>();
        for (int i = 1; i < rs.Count; i++)
        {
            string code = Str(rs, i, "F_ORT_NR");
            string text = Str(rs, i, "F_ORT_TEXT");
            if (code.Length == 0 && text.Length == 0) continue;
            bool present = Str(rs, i, "F_VORHANDEN") == "1";
            faults.Add(new FaultEntry(code, text, present, false, ""));
        }
        return new FaultResult(true, faults);
    }

    public LiveResult ReadLive(string[] ids)
    {
        // 権威データの result→job 表で必要なジョブだけをグループ実行し、
        // 値(_WERT)と ECU が返す実単位(_EINH)を取り出す。
        var values = new Dictionary<string, object?>();
        var units = new Dictionary<string, string>();
        foreach (var grp in ids.Where(_paramJob.ContainsKey).GroupBy(id => _paramJob[id]))
        {
            if (string.IsNullOrEmpty(grp.Key)) continue;
            List<Dictionary<string, EdiabasNet.ResultData>> rs;
            try { rs = Run(grp.Key); } catch { continue; }   // 1ジョブ失敗で全体を止めない
            foreach (string id in grp)
            {
                for (int i = 1; i < rs.Count; i++)
                {
                    if (!rs[i].TryGetValue(id, out EdiabasNet.ResultData? v) || v == null) continue;
                    values[id] = v.OpData;                   // EdiabasLib が型・スケーリング済みで返す
                    if (_paramUnit.TryGetValue(id, out string? un) && !string.IsNullOrEmpty(un)
                        && rs[i].TryGetValue(un, out EdiabasNet.ResultData? uv) && uv != null)
                        units[id] = uv.OpData?.ToString() ?? "";   // ★実単位はここでしか得られない
                    break;
                }
            }
        }
        return new LiveResult(values, units);
    }

    public JobResult RunJob(string job, string[]? args)
    {
        var rs = Run(job, args != null ? string.Join(";", args) : "");
        string status = Str(rs, 0, "JOB_STATUS");
        Dictionary<string, object?>? results = null;
        if (rs.Count > 0)
        {
            results = new Dictionary<string, object?>();
            foreach (var kv in rs[0])
            {
                if (kv.Key == "JOB_STATUS") continue;   // status で別途表示済み
                results[kv.Key] = kv.Value?.OpData;
            }
            if (results.Count == 0) results = null;
        }
        return new JobResult(status.Length == 0 || status.Contains("OKAY"), status, results);
    }
#else
    // ---- EdiabasLib 未参照時のフォールバック（明示エラー） --------------------
    private static Exception NotWired() => new InvalidOperationException(
        "EdiabasLib 未結線です。host/OldBmwDiagHost.csproj に EdiabasLib 参照を追加し " +
        "DefineConstants=EDIABASLIB でビルドしてください（詳細は host/README.md）。" +
        "検証・デモは --backend mock を使用。");

    public void Connect(string ecuId, string? iface) { CurrentEcu = ecuId; throw NotWired(); }
    public IdentResult ReadIdent() => throw NotWired();
    public FaultResult ReadFaults() => throw NotWired();
    public LiveResult ReadLive(string[] ids) => throw NotWired();
    public JobResult RunJob(string job, string[]? args) => throw NotWired();
#endif
}
