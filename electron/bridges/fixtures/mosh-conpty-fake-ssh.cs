using System;

internal static class Program
{
    private const string Password = "netcatty-test-password";

    public static int Main()
    {
        Console.Write("alice@example.com's password: \x1b[?25h");
        string supplied = Console.ReadLine();
        if (!String.Equals(supplied, Password, StringComparison.Ordinal))
        {
            Console.Error.WriteLine("unexpected password");
            return 41;
        }

        Console.WriteLine("MOSH IP 127.0.0.1");
        // Deliberately omit the final newline. Windows ConPTY can deliver the
        // marker this way when ssh exits, and Netcatty must still switch.
        Console.Write("MOSH CONNECT 60002 ABCDEFGHIJKLMNOPQRSTUV==");
        return 0;
    }
}
