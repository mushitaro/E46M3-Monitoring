namespace OldBmwDiagHost.Backends;

/// <summary>
/// 記録デコレータ。任意のバックエンド（通常は ediabas=実車）をラップし、全応答を
/// Recording に取り込んでファイルへ保存する。実車セッションを1回記録するために使う。
///   例)  dotnet run -c Release -p:UseEdiabas=true -- --backend ediabas --record recordings\m3.json
/// </summary>
public sealed class RecordingBackend : IDiagBackend
{
    private readonly IDiagBackend _inner;
    private readonly string _path;
    private readonly Recording _rec = new();
    private long _lastLiveSave;

    public string Name => _inner.Name + "+rec";
    public string? CurrentEcu => _inner.CurrentEcu;

    public RecordingBackend(IDiagBackend inner, string path)
    {
        _inner = inner; _path = path;
        _rec.sourceBackend = inner.Name;
        _rec.recordedAt = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
    }

    public object ListEcus() => _inner.ListEcus();

    public void Connect(string ecuId, string? iface)
    {
        _inner.Connect(ecuId, iface);
        _rec.ecu = ecuId;
        Save();
    }

    public IdentResult ReadIdent()
    {
        var r = _inner.ReadIdent();
        _rec.ident = r; _rec.sgbd = r.note; Save();
        return r;
    }

    public FaultResult ReadFaults()
    {
        var r = _inner.ReadFaults();
        _rec.faults = r; Save();
        return r;
    }

    public LiveResult ReadLive(string[] ids)
    {
        var r = _inner.ReadLive(ids);
        foreach (var id in ids)
            if (r.values.TryGetValue(id, out var v))
                _rec.live[id] = new LiveCell { value = v, unit = r.units.GetValueOrDefault(id, "") };
        // ライブは高頻度なので保存は間引く（最新スナップショットで十分）
        long now = Environment.TickCount64;
        if (now - _lastLiveSave > 2000) { _lastLiveSave = now; Save(); }
        return r;
    }

    public JobResult RunJob(string job, string[]? args)
    {
        var r = _inner.RunJob(job, args);
        _rec.jobs[job + "|" + (args != null ? string.Join(",", args) : "")] = r;
        Save();
        return r;
    }

    private void Save()
    {
        try { _rec.Save(_path); }
        catch (Exception e) { Console.Error.WriteLine("[rec] save失敗: " + e.Message); }
    }
}
