using System;

internal static class Program
{
    public static int Main(string[] args)
    {
        string key = Environment.GetEnvironmentVariable("MOSH_KEY") ?? "";
        string fallback = Environment.GetEnvironmentVariable("MOSH_FALLBACK_HOST") ?? "";
        Console.WriteLine(
            "MOSHCATTY_TEST_READY key=" + key
            + " args=" + String.Join("|", args)
            + " fallback=" + fallback
        );

        string line;
        while ((line = Console.ReadLine()) != null)
        {
            if (String.Equals(line, "quit", StringComparison.Ordinal))
            {
                return 0;
            }
            Console.WriteLine("MOSHCATTY_TEST_ECHO=" + line);
        }
        return 0;
    }
}
