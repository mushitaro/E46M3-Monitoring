namespace OldBmwDiagHost.Backends;

/// <summary>
/// 診断バックエンドの抽象。PWA からの HTTP/WS 要求を、実際の ECU 通信
/// （EdiabasLib / 元 EDIABAS api32.dll）または mock に振り分ける。
/// </summary>
public interface IDiagBackend
{
    string Name { get; }
    string? CurrentEcu { get; }

    /// <summary>利用可能な ECU プロファイル一覧（ecu-data/index.json 由来）。</summary>
    object ListEcus();

    /// <summary>対象 ECU とインターフェース（STD:OBD / ADS / ENET 等）を選択。</summary>
    void Connect(string ecuId, string? iface);

    /// <summary>ECU 識別（ZB/HW/SW/日付）。</summary>
    IdentResult ReadIdent();

    /// <summary>故障メモリ（コード＋本文）。</summary>
    FaultResult ReadFaults();

    /// <summary>指定 result id 群のライブ値（スケーリング済み）＋ECUが返す実単位。</summary>
    LiveResult ReadLive(string[] ids);

    /// <summary>任意ジョブ実行（将来のアクチュエータ/コーディング用）。</summary>
    JobResult RunJob(string job, string[]? args);
}

public record IdentResult(string zbNr, string hwNr, string swVersion, string date, string? note = null);

public record FaultEntry(string code, string desc, bool present, bool sporadic, string raw);
public record FaultResult(bool ok, List<FaultEntry> faults);

public record JobResult(bool ok, string status, Dictionary<string, object?>? results = null);

/// <summary>ライブ読取結果。units は ECU が実行時に返す実単位（_EINH 結果）。
/// SGBDのメタデータには実単位が無いため、ここでしか得られない。</summary>
public record LiveResult(Dictionary<string, object?> values, Dictionary<string, string> units);
