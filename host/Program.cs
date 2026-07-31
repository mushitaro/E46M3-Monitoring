// ============================================================================
//  OldBmwDiagHost — ローカル EDIABAS/EdiabasLib ブリッジ
//  ブラウザPWA(UI) ↔ localhost HTTP ↔ このホスト(EdiabasLib) ↔ K+DCAN ↔ ECU
//  起動:  dotnet run -- --backend mock            (ハード不要・検証用)
//         dotnet run -- --backend ediabas         (実機/EdiabasLib結線後)
// ============================================================================
using System.Text.Json;
using OldBmwDiagHost.Backends;

#if EDIABASLIB
// EdiabasLib は Windows-1252 を使う。.NET Core では既定で未登録なので登録必須
// （未登録だと EdiabasNet の型初期化子で例外＝実車接続時に発覚したバグ）。
System.Text.Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);
#endif

string Arg(string key, string def)
{
    var i = Array.IndexOf(args, key);
    return i >= 0 && i + 1 < args.Length ? args[i + 1] : def;
}

var port = Arg("--port", "5199");
var backendName = Arg("--backend", "mock");

// 実車(ediabas)用の COMポート。launch.json/CLI から渡せる（未指定なら EDIABAS_COMPORT env → 既定COM3）
var comPort = Arg("--comport", "");
if (comPort.Length > 0) Environment.SetEnvironmentVariable("EDIABAS_COMPORT", comPort);

// ecu-data フォルダを解決（host/ の一つ上）
string ecuData = Arg("--ecu-data", "");
if (ecuData.Length == 0)
{
    foreach (var cand in new[] {
        Path.Combine(Directory.GetCurrentDirectory(), "..", "ecu-data"),
        Path.Combine(Directory.GetCurrentDirectory(), "ecu-data"),
        Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "ecu-data"),
    })
    { if (Directory.Exists(cand)) { ecuData = Path.GetFullPath(cand); break; } }
}
if (!Directory.Exists(ecuData)) { Console.Error.WriteLine($"[FATAL] ecu-data が見つかりません: {ecuData}"); return; }

var recordPath = Arg("--record", "");        // 指定すると全応答を記録（実車セッション保存）
var recordingIn = Arg("--recording", "");    // replay 時に読む記録ファイル

IDiagBackend backend = backendName.ToLowerInvariant() switch
{
    "ediabas" => new EdiabasLibBackend(ecuData),
    "replay" => new ReplayBackend(ecuData, recordingIn.Length > 0 ? recordingIn
                    : throw new ArgumentException("--backend replay には --recording <file> が必要")),
    _ => new MockBackend(ecuData),
};
// 記録モード（replay 以外をラップ）。実車=ediabas と併用して実データを保存する。
if (recordPath.Length > 0 && backendName.ToLowerInvariant() != "replay")
    backend = new RecordingBackend(backend, Path.GetFullPath(recordPath));

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.WebHost.UseUrls($"http://127.0.0.1:{port}");
var app = builder.Build();

// CORS（PWA は別ポート＝別オリジン。localhost のみ許可）
app.Use(async (ctx, next) =>
{
    ctx.Response.Headers["Access-Control-Allow-Origin"] = "*";
    ctx.Response.Headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS";
    ctx.Response.Headers["Access-Control-Allow-Headers"] = "Content-Type";
    if (HttpMethods.IsOptions(ctx.Request.Method)) { ctx.Response.StatusCode = 204; return; }
    await next();
});

var jsonOpts = new JsonSerializerOptions { PropertyNamingPolicy = null };
IResult J(object o) => Results.Json(o, jsonOpts);
IResult Err(Exception e) => Results.Json(new { ok = false, error = e.Message }, jsonOpts, statusCode: 400);

app.MapGet("/api/info", () => J(new { ok = true, backend = backend.Name, ecu = backend.CurrentEcu, version = "0.1",
    recording = recordPath.Length > 0 ? Path.GetFullPath(recordPath) : null }));
app.MapGet("/api/ecus", () => { try { return J(backend.ListEcus()); } catch (Exception e) { return Err(e); } });

app.MapPost("/api/connect", async (HttpContext c) =>
{
    try
    {
        var req = await JsonSerializer.DeserializeAsync<ConnectReq>(c.Request.Body) ?? new ConnectReq();
        backend.Connect(req.ecuId ?? "", req.iface);
        return J(new { ok = true, ecu = backend.CurrentEcu, backend = backend.Name });
    }
    catch (Exception e) { return Err(e); }
});

app.MapGet("/api/ident", () => { try { return J(backend.ReadIdent()); } catch (Exception e) { return Err(e); } });
app.MapGet("/api/faults", () => { try { return J(backend.ReadFaults()); } catch (Exception e) { return Err(e); } });
app.MapGet("/api/live", (string? ids) =>
{
    try
    {
        var list = (ids ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var lr = backend.ReadLive(list);
        return J(new { ok = true, t = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), values = lr.values, units = lr.units });
    }
    catch (Exception e) { return Err(e); }
});
app.MapPost("/api/job", async (HttpContext c) =>
{
    try
    {
        var req = await JsonSerializer.DeserializeAsync<JobReq>(c.Request.Body) ?? new JobReq();
        return J(backend.RunJob(req.job ?? "", req.args));
    }
    catch (Exception e) { return Err(e); }
});

Console.WriteLine($"OldBmwDiagHost  backend={backend.Name}  ecu-data={ecuData}");
Console.WriteLine($"  → http://127.0.0.1:{port}/api/info");
app.Run();

record ConnectReq { public string? ecuId { get; set; } public string? iface { get; set; } }
record JobReq { public string? job { get; set; } public string[]? args { get; set; } }
