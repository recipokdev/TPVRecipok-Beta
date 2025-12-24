using System;
using System.Runtime.InteropServices;
using System.Text;

class Program
{
    // WinSpool RAW printing
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOCINFO
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName = "OpenCashDrawer";
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile = null;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType = "RAW";
    }

    [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool OpenPrinter(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern int StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFO di);

    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

    static int Main(string[] args)
    {
        // Uso:
        // open-drawer.exe "<PrinterName>" [pin] [t1] [t2]
        // pin: 0 o 1 (cajón)
        // t1/t2: duración del pulso (default 25, 250)
        if (args.Length < 1)
        {
            Console.Error.WriteLine("Usage: open-drawer.exe \"PrinterName\" [pin] [t1] [t2]");
            return 2;
        }

        string printerName = args[0];
        int pin = args.Length >= 2 && int.TryParse(args[1], out var p) ? p : 0;
        int t1  = args.Length >= 3 && int.TryParse(args[2], out var a) ? a : 25;
        int t2  = args.Length >= 4 && int.TryParse(args[3], out var b) ? b : 250;

        if (pin != 0 && pin != 1) pin = 0;
        if (t1 < 0 || t1 > 255) t1 = 25;
        if (t2 < 0 || t2 > 255) t2 = 250;

        // ESC p m t1 t2
        byte[] cmd = new byte[] { 0x1B, 0x70, (byte)pin, (byte)t1, (byte)t2 };

        if (!OpenPrinter(printerName, out IntPtr hPrinter, IntPtr.Zero) || hPrinter == IntPtr.Zero)
        {
            int err = Marshal.GetLastWin32Error();
            Console.Error.WriteLine($"OpenPrinter failed ({err}) for '{printerName}'");
            return 3;
        }

        try
        {
            var di = new DOCINFO();
            int jobId = StartDocPrinter(hPrinter, 1, di);
            if (jobId <= 0)
            {
                int err = Marshal.GetLastWin32Error();
                Console.Error.WriteLine($"StartDocPrinter failed ({err})");
                return 4;
            }

            try
            {
                if (!StartPagePrinter(hPrinter))
                {
                    int err = Marshal.GetLastWin32Error();
                    Console.Error.WriteLine($"StartPagePrinter failed ({err})");
                    return 5;
                }

                try
                {
                    if (!WritePrinter(hPrinter, cmd, cmd.Length, out int written) || written != cmd.Length)
                    {
                        int err = Marshal.GetLastWin32Error();
                        Console.Error.WriteLine($"WritePrinter failed ({err}), written={written}");
                        return 6;
                    }
                }
                finally
                {
                    EndPagePrinter(hPrinter);
                }
            }
            finally
            {
                EndDocPrinter(hPrinter);
            }

            // OK
            Console.WriteLine("OK");
            return 0;
        }
        finally
        {
            ClosePrinter(hPrinter);
        }
    }
}
