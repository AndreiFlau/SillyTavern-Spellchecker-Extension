// Gives ST-Spellcheck access to the Windows spell checker, which a browser extension cannot reach.
//
// Answers spelling questions from the TauriTavern page over 127.0.0.1 only. It stores nothing,
// and refuses requests from any other web page. Build with build.cmd.
//
//   st-spellcheck-helper.exe            serve until closed
//   st-spellcheck-helper.exe --run-app  also start TauriTavern, and exit when it closes
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
using System.Threading;

[ComImport, Guid("7AB36653-1796-484B-BDFA-E74F1DB7C1DC")]
class SpellCheckerFactoryClass { }

[ComImport, Guid("8E018A9D-2415-4677-BF08-794EA61F94BB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISpellCheckerFactory
{
    IEnumString get_SupportedLanguages();
    int IsSupported([MarshalAs(UnmanagedType.LPWStr)] string tag);
    ISpellChecker CreateSpellChecker([MarshalAs(UnmanagedType.LPWStr)] string tag);
}

// Only the leading methods are declared; COM calls by position, so the rest can be left out.
[ComImport, Guid("B6FD0B71-E2BC-4653-8D05-F197E412770B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISpellChecker
{
    [return: MarshalAs(UnmanagedType.LPWStr)] string get_LanguageTag();
    IEnumSpellingError Check([MarshalAs(UnmanagedType.LPWStr)] string text);
    IEnumString Suggest([MarshalAs(UnmanagedType.LPWStr)] string word);
}

[ComImport, Guid("803E3BD4-2828-4410-8290-418D1D73C762"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IEnumSpellingError
{
    [PreserveSig] int Next(out ISpellingError value);
}

[ComImport, Guid("B7C82D61-FBE8-4B47-9B27-6C0D2E0DE0A3"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISpellingError
{
    uint get_StartIndex();
}

static class Program
{
    const int Port = 47921;
    const int MaxHeaderBytes = 16 * 1024;
    const int MaxBodyBytes = 2 * 1024 * 1024;
    const int MaxWordLength = 200;
    const int MaxSuggestions = 8;
    static readonly string[] AllowedOrigins = { "http://tauri.localhost", "https://tauri.localhost", "tauri://localhost" };
    static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);

    static ISpellChecker portuguese;
    static ISpellChecker english;

    [STAThread]
    static int Main(string[] args)
    {
        bool runApp = Array.IndexOf(args, "--run-app") >= 0;

        TcpListener listener = new TcpListener(IPAddress.Loopback, Port);
        try
        {
            listener.Start();
        }
        catch (SocketException)
        {
            // Another copy is already serving, so all that is left to do is open the app.
            if (runApp) StartApp();
            return 0;
        }

        ISpellCheckerFactory factory = (ISpellCheckerFactory)new SpellCheckerFactoryClass();
        portuguese = factory.CreateSpellChecker("pt-BR");
        english = factory.CreateSpellChecker("en-US");

        if (runApp)
        {
            Process app = StartApp();
            Thread watcher = new Thread(() =>
            {
                app.WaitForExit();
                Environment.Exit(0);
            });
            watcher.IsBackground = true;
            watcher.Start();
        }

        while (true)
        {
            using (TcpClient client = listener.AcceptTcpClient())
            {
                try
                {
                    client.ReceiveTimeout = 3000;
                    client.SendTimeout = 3000;
                    Handle(client.GetStream());
                }
                catch (IOException) { }
                catch (SocketException) { }
            }
        }
    }

    static Process StartApp()
    {
        string exe = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TauriTavern", "tauritavern.exe");
        ProcessStartInfo info = new ProcessStartInfo(exe);
        info.UseShellExecute = false;
        info.WorkingDirectory = Path.GetDirectoryName(exe);
        return Process.Start(info);
    }

    static void Handle(NetworkStream stream)
    {
        Dictionary<string, string> headers;
        string method, path;
        byte[] leftover;
        if (!ReadHead(stream, out method, out path, out headers, out leftover))
        {
            Respond(stream, "400 Bad Request", null, "");
            return;
        }

        string origin, host;
        headers.TryGetValue("origin", out origin);
        headers.TryGetValue("host", out host);
        // Any web page can try to reach 127.0.0.1, so requests must prove they come from the app.
        // The Host check stops a hostile site pointing its own domain name at this address.
        bool hostOk = host == "127.0.0.1:" + Port || host == "localhost:" + Port;
        if (origin == null || Array.IndexOf(AllowedOrigins, origin) < 0 || !hostOk)
        {
            Respond(stream, "403 Forbidden", null, "");
            return;
        }

        if (method == "OPTIONS")
        {
            Respond(stream, "204 No Content", origin, "");
        }
        else if (method == "GET" && path == "/health")
        {
            Respond(stream, "200 OK", origin, "st-spellcheck-helper 1");
        }
        else if (method == "POST" && (path == "/check" || path == "/suggest"))
        {
            string body;
            if (!ReadBody(stream, headers, leftover, out body))
            {
                Respond(stream, "413 Payload Too Large", origin, "");
                return;
            }
            Respond(stream, "200 OK", origin, path == "/check" ? CheckWords(body) : SuggestWord(body));
        }
        else
        {
            Respond(stream, "404 Not Found", origin, "");
        }
    }

    // One line per word, in order: two digits, Portuguese then English, 1 = accepted.
    static string CheckWords(string body)
    {
        StringBuilder result = new StringBuilder();
        foreach (string word in body.Split('\n'))
        {
            result.Append(IsCorrect(portuguese, word) ? '1' : '0');
            result.Append(IsCorrect(english, word) ? '1' : '0');
            result.Append('\n');
        }
        return result.ToString();
    }

    // One line per suggestion: "pt" or "en", a tab, then the word.
    static string SuggestWord(string word)
    {
        StringBuilder result = new StringBuilder();
        if (word.Length == 0 || word.Length > MaxWordLength) return "";
        foreach (string s in Suggestions(portuguese, word)) result.Append("pt\t").Append(s).Append('\n');
        foreach (string s in Suggestions(english, word)) result.Append("en\t").Append(s).Append('\n');
        return result.ToString();
    }

    static bool IsCorrect(ISpellChecker checker, string word)
    {
        if (word.Length == 0 || word.Length > MaxWordLength) return false;
        ISpellingError error;
        return checker.Check(word).Next(out error) != 0;
    }

    static List<string> Suggestions(ISpellChecker checker, string word)
    {
        List<string> result = new List<string>();
        IEnumString list = checker.Suggest(word);
        string[] one = new string[1];
        IntPtr fetched = Marshal.AllocCoTaskMem(4);
        try
        {
            while (result.Count < MaxSuggestions && list.Next(1, one, fetched) == 0) result.Add(one[0]);
        }
        finally
        {
            Marshal.FreeCoTaskMem(fetched);
        }
        return result;
    }

    static bool ReadHead(NetworkStream stream, out string method, out string path, out Dictionary<string, string> headers, out byte[] leftover)
    {
        method = path = null;
        headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        leftover = new byte[0];

        MemoryStream data = new MemoryStream();
        byte[] buffer = new byte[4096];
        int headEnd = -1;
        while (headEnd < 0)
        {
            int read = stream.Read(buffer, 0, buffer.Length);
            if (read <= 0) return false;
            data.Write(buffer, 0, read);
            if (data.Length > MaxHeaderBytes) return false;
            headEnd = FindHeadEnd(data.GetBuffer(), (int)data.Length);
        }

        byte[] all = data.ToArray();
        string[] lines = Encoding.ASCII.GetString(all, 0, headEnd).Split(new[] { "\r\n" }, StringSplitOptions.None);
        string[] request = lines[0].Split(' ');
        if (request.Length < 2) return false;
        method = request[0];
        path = request[1];
        for (int i = 1; i < lines.Length; i++)
        {
            int colon = lines[i].IndexOf(':');
            if (colon > 0) headers[lines[i].Substring(0, colon).Trim()] = lines[i].Substring(colon + 1).Trim();
        }

        int bodyStart = headEnd + 4;
        leftover = new byte[all.Length - bodyStart];
        Array.Copy(all, bodyStart, leftover, 0, leftover.Length);
        return true;
    }

    static int FindHeadEnd(byte[] data, int length)
    {
        for (int i = 3; i < length; i++)
        {
            if (data[i - 3] == 13 && data[i - 2] == 10 && data[i - 1] == 13 && data[i] == 10) return i - 3;
        }
        return -1;
    }

    static bool ReadBody(NetworkStream stream, Dictionary<string, string> headers, byte[] leftover, out string body)
    {
        body = "";
        string lengthText;
        int length = 0;
        if (headers.TryGetValue("content-length", out lengthText) && !int.TryParse(lengthText, out length)) return false;
        if (length < 0 || length > MaxBodyBytes) return false;

        byte[] bytes = new byte[length];
        int have = Math.Min(leftover.Length, length);
        Array.Copy(leftover, bytes, have);
        while (have < length)
        {
            int read = stream.Read(bytes, have, length - have);
            if (read <= 0) return false;
            have += read;
        }
        body = Utf8.GetString(bytes);
        return true;
    }

    static void Respond(NetworkStream stream, string status, string origin, string body)
    {
        byte[] content = Utf8.GetBytes(body);
        StringBuilder head = new StringBuilder();
        head.Append("HTTP/1.1 ").Append(status).Append("\r\n");
        head.Append("Content-Type: text/plain; charset=utf-8\r\n");
        head.Append("Content-Length: ").Append(content.Length).Append("\r\n");
        head.Append("Connection: close\r\n");
        if (origin != null)
        {
            head.Append("Access-Control-Allow-Origin: ").Append(origin).Append("\r\n");
            head.Append("Vary: Origin\r\n");
            head.Append("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n");
            head.Append("Access-Control-Allow-Headers: content-type\r\n");
            head.Append("Access-Control-Allow-Private-Network: true\r\n");
        }
        head.Append("\r\n");
        byte[] headBytes = Encoding.ASCII.GetBytes(head.ToString());
        stream.Write(headBytes, 0, headBytes.Length);
        stream.Write(content, 0, content.Length);
    }
}
