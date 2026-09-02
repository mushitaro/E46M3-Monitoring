// ============================================================================
//  SgbdDump — EdiabasLib の仮想ジョブで SGBD から「権威ある」ジョブ表を取得
//  （Tool32 が表示するのと同じ情報。車両接続は不要 = SGBD を読むだけ）
//
//    _JOBS        → ジョブ名一覧   (result: JOBNAME)
//    _JOBCOMMENTS → ジョブ説明文   (arg: ジョブ名, result: JOBCOMMENT0..n)
//    _ARGUMENTS   → ジョブ引数     (ARG/ARGTYPE/ARGCOMMENT0..n)
//    _RESULTS     → ジョブ結果     (RESULT/RESULTTYPE/RESULTCOMMENT0..n)
//
//  ハマりどころ:
//   1) EdiabasLib は Windows-1252 を使う → CodePagesEncodingProvider の登録が必須
//   2) 仮想ジョブでも通信クラスが要り、かつ Simulation=1 でないと IFH-0018 になる
//
//  使い方: dotnet run -c Release -- MSS54DS0 SMG2 ASCMK20 dsc_mk60
//          出力: $SGBD_DUMP_DIR/<sgbd>.json  (既定 C:\EDIABAS-derived\sgbd-dumps)
//                リポジトリ木の外。理由は下の outDir とその上のコメント。
// ============================================================================
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Text.Json;
using EdiabasLib;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);   // ★必須

string ecuPath = Environment.GetEnvironmentVariable("EDIABAS_ECU_PATH") ?? @"C:\EDIABAS\ECU";
string simPath = Environment.GetEnvironmentVariable("EDIABAS_SIM_PATH") ?? @"C:\EDIABAS\SIM";
// 出力先はリポジトリ木の**外**。ダンプは BMW の SGBD 由来で再配布できず
// (THIRD-PARTY-NOTICES.md §3.1)、木の中に置くと `git add -A` 一回で公開される。
// Python 側 tools/paths.py が同じ環境変数と同じ既定値を独立に持つ。片方だけ変えないこと。
string outDir = Environment.GetEnvironmentVariable("SGBD_DUMP_DIR") ?? @"C:\EDIABAS-derived\sgbd-dumps";
Directory.CreateDirectory(outDir);

// --exec <SGBD> <JOB> : シミュレーションで実ジョブを実行し、返る結果(値/単位)を確認する検証モード
if (args.Length >= 3 && args[0] == "--exec")
{
    string sg = args[1], job = args[2];
    string argStr = args.Length >= 4 ? args[3] : "";
    try
    {
        using var ed = new EdiabasNet(string.Empty);
        ed.EdInterfaceClass = new EdInterfaceObd();
        ed.SetConfigProperty("EcuPath", ecuPath);
        ed.SetConfigProperty("Simulation", "1");
        ed.SetConfigProperty("SimulationPath", simPath);
        ed.SetConfigProperty("ApiTrace", "1");
        ed.SetConfigProperty("IfhTrace", "3");
        ed.SetConfigProperty("TracePath", System.IO.Path.GetFullPath("trc"));
        ed.SetConfigProperty("TraceBuffering", "0");
        ed.ResolveSgbdFile(sg);
        // If argStr looks like hex (all hex digits, even length), pass it as a BINARY argument
        // — this is how the flash jobs receive their pre-filled BINAER_BUFFER.
        string hex = argStr.Replace(" ", "");
        bool isHex = hex.Length >= 2 && hex.Length % 2 == 0 && System.Text.RegularExpressions.Regex.IsMatch(hex, "^[0-9A-Fa-f]+$");
        if (isHex)
        {
            byte[] bin = new byte[hex.Length / 2];
            for (int i = 0; i < bin.Length; i++) bin[i] = Convert.ToByte(hex.Substring(i * 2, 2), 16);
            ed.ArgString = "";       // set string first (both share _argInfo.BinData)
            ed.ArgBinary = bin;      // binary wins
        }
        else { ed.ArgString = argStr; }
        ed.ResultsRequests = "";
        ed.ExecuteJob(job);
        Console.WriteLine($"EXEC {sg}.{job} -> resultSets={ed.ResultSets.Count}");
        foreach (var rs in ed.ResultSets)
            foreach (var kv in rs)
            {
                var v = kv.Value.OpData;
                string shown = v is byte[] b ? BitConverter.ToString(b).Replace("-", " ") : v?.ToString() ?? "";
                Console.WriteLine($"   {kv.Key,-38} = {shown}");
            }
    }
    catch (Exception ex)
    {
        Console.WriteLine($"EXEC {sg}.{job} FAILED: {ex.Message}");
        for (Exception? e2 = ex.InnerException; e2 != null; e2 = e2.InnerException)
            Console.WriteLine($"   inner: {e2.Message}");
    }
    return;
}

string[] sgbds = args.Length > 0 ? args : new[] { "SMG2" };

foreach (string sgbd in sgbds)
{
    try
    {
        Console.WriteLine($"=== {sgbd} ===");
        using var ediabas = new EdiabasNet(string.Empty);
        ediabas.EdInterfaceClass = new EdInterfaceObd();          // ★通信クラスの存在が要る
        ediabas.SetConfigProperty("EcuPath", ecuPath);
        ediabas.SetConfigProperty("Simulation", "1");             // ★車両なしで実行するため
        ediabas.SetConfigProperty("SimulationPath", simPath);
        ediabas.ResolveSgbdFile(sgbd);

        // --- ジョブ名一覧 ---
        var jobs = new List<string>();
        foreach (var rs in Sets(ediabas, "_JOBS", ""))
            if (rs.TryGetValue("JOBNAME", out string? n) && !string.IsNullOrEmpty(n)) jobs.Add(n);

        // --- 各ジョブの説明/引数/結果 ---
        var dump = new List<object>();
        foreach (string job in jobs)
        {
            string comment = string.Join(" / ", Sets(ediabas, "_JOBCOMMENTS", job)
                .SelectMany(d => d.Where(kv => kv.Key.StartsWith("JOBCOMMENT")).OrderBy(kv => kv.Key).Select(kv => kv.Value)));
            var argList = Sets(ediabas, "_ARGUMENTS", job).Select(d => Item(d, "ARG")).Where(x => x != null).ToList();
            var resList = Sets(ediabas, "_RESULTS", job).Select(d => Item(d, "RESULT")).Where(x => x != null).ToList();
            dump.Add(new { job, comment, args = argList, results = resList });
        }

        // --- テーブル抽出（Testprg/STELLGLIEDER 等 = 手順定義の権威ソース） ---
        //  SGBD内部のテーブル名辞書(全テーブル)＋ジョブ説明の "table <名>" 参照を収集し、
        //  GetTableLines で内容を取得（1行目=列名, 以降=データ行）。
        var tableNames = TableNames(ediabas);
        foreach (Match m in Regex.Matches(string.Join(" / ", dump.Select(x => ((dynamic)x).comment)),
                     @"table\s+([A-Za-z_][A-Za-z0-9_]*)", RegexOptions.IgnoreCase))
            tableNames.Add(m.Groups[1].Value);
        var tables = new Dictionary<string, List<List<string>>>();
        foreach (string tn in tableNames)
        {
            try { var lines = ediabas.GetTableLines(tn); if (lines != null && lines.Count > 0) tables[tn] = lines; }
            catch { /* 存在しない/読めないテーブルは無視 */ }
        }

        // ダンプ自身に出所を書かせる。これが無いと check_references.py はダンプの
        // ハッシュしか照合できず、「ダンプは変わっていない」とは言えても
        // 「元の .prg が変わっていない」とは言えない。
        string? prg = ResolvePrgPath(ecuPath, sgbd);
        string? prgSha = prg is null ? null : Convert.ToHexString(
            System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(prg))).ToLowerInvariant();
        string dumpedAt = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ");

        string path = Path.Combine(outDir, sgbd + ".json");
        File.WriteAllText(path, JsonSerializer.Serialize(new { sgbd, jobCount = jobs.Count, dumpedAt, sgbdSha256 = prgSha, jobs = dump, tables },
            new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }));
        Console.WriteLine($"  jobs: {jobs.Count}  tables: {tables.Count} [{string.Join(", ", tables.Keys)}]  -> {path}");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"  ERR {sgbd}: {ex.Message}");
        for (Exception? e2 = ex.InnerException; e2 != null; e2 = e2.InnerException)
            Console.WriteLine($"    inner: {e2.GetType().Name}: {e2.Message}");
    }
}

// SGBD内部の全テーブル名を取得（private _tableInfos.TableNameDict をリフレクションで）。
// これで手順定義テーブル(Testprg/STELLGLIEDER 等)を漏れなく列挙できる。
static HashSet<string> TableNames(EdiabasNet e)
{
    var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    try
    {
        var fi = typeof(EdiabasNet).GetField("_tableInfos", BindingFlags.NonPublic | BindingFlags.Instance);
        var infos = fi?.GetValue(e);
        var dictProp = infos?.GetType().GetProperty("TableNameDict");
        if (dictProp?.GetValue(infos) is System.Collections.IDictionary dict)
            foreach (var k in dict.Keys) if (k != null) names.Add(k.ToString()!);
    }
    catch { /* 取れなければ comment 由来の参照だけ使う */ }
    return names;
}

// 仮想ジョブを実行し、結果セットごとに key=value を辞書化（グループ化を保持）
static List<Dictionary<string, string>> Sets(EdiabasNet e, string vjob, string arg)
{
    var outp = new List<Dictionary<string, string>>();
    try
    {
        e.ArgString = arg; e.ResultsRequests = "";
        e.ExecuteJob(vjob);
        foreach (var rs in e.ResultSets.Skip(1))
        {
            var d = new Dictionary<string, string>();
            foreach (var kv in rs)
            {
                string s = kv.Value.OpData?.ToString() ?? "";
                if (s.Length > 0) d[kv.Key] = s;
            }
            if (d.Count > 0) outp.Add(d);
        }
    }
    catch { /* 未対応SGBDは空 */ }
    return outp;
}

// {RESULT:..., RESULTTYPE:..., RESULTCOMMENT0:...} → {name,type,comment}
static object? Item(Dictionary<string, string> d, string prefix)
{
    if (!d.TryGetValue(prefix, out string? name) || string.IsNullOrEmpty(name)) return null;
    d.TryGetValue(prefix + "TYPE", out string? type);
    string comment = string.Join(" / ", d.Where(kv => kv.Key.StartsWith(prefix + "COMMENT"))
        .OrderBy(kv => kv.Key).Select(kv => kv.Value));
    return new { name, type = type ?? "", comment };
}

// SGBD 名から実ファイルを引く。EDIABAS のディレクトリは大文字小文字が一定しない
// （実在例: ews3.prg / EWS3D.prg）ので、素朴な Path.Combine では取り逃がす。
static string? ResolvePrgPath(string ecuPath, string sgbd)
{
    try
    {
        string exact = Path.Combine(ecuPath, sgbd + ".prg");
        if (File.Exists(exact)) return exact;
        foreach (string f in Directory.EnumerateFiles(ecuPath, "*.prg"))
            if (string.Equals(Path.GetFileNameWithoutExtension(f), sgbd, StringComparison.OrdinalIgnoreCase))
                return f;
    }
    catch { /* ECU ディレクトリが無い環境では来歴なしで続ける */ }
    return null;
}
