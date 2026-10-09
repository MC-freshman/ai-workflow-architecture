# Packaged Windows task controller. Input is JSON, never interpolated PowerShell.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$specification = [Console]::In.ReadLine() | ConvertFrom-Json
$managerCancelEvent = $null
if ($specification.cancelEvent -and -not $specification.deferCancellation) {
  $managerCancelEvent = New-Object Threading.EventWaitHandle($false, [Threading.EventResetMode]::ManualReset, [string]$specification.cancelEvent)
}
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class ArchitectureManagerOwnedJob {
  [StructLayout(LayoutKind.Sequential)] struct SA { public int length; public IntPtr descriptor; public int inherit; }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct STARTUP {
    public int cb; public string reserved,desktop,title; public int x,y,xSize,ySize,xChars,yChars,fill,flags;
    public short show,reservedSize; public IntPtr reservedPointer,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS { public IntPtr process,thread; public int pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC {
    public long userTime,jobTime; public uint flags; public UIntPtr minWorking,maxWorking;
    public uint activeLimit; public UIntPtr affinity; public uint priority,scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct IO {public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes;}
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED {public BASIC basic;public IO io;public UIntPtr processMemory,jobMemory,peakProcess,peakJob;}
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CreatePipe(out IntPtr read,out IntPtr write,ref SA security,int size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,int mask,int flags);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr security,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int type,ref EXTENDED information,int length);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string application,StringBuilder command,IntPtr processSecurity,IntPtr threadSecurity,bool inherit,uint flags,IntPtr environment,string cwd,ref STARTUP startup,out PROCESS process);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static void Check(bool result) {if(!result) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());}
  static string Quote(string argument) {
    var output=new StringBuilder("\"");int slashes=0;
    foreach(char c in argument) {
      if(c=='\\') {slashes++;continue;}
      if(c=='"') output.Append('\\',slashes*2+1).Append('"');
      else output.Append('\\',slashes).Append(c);
      slashes=0;
    }
    return output.Append('\\',slashes*2).Append('"').ToString();
  }
  public static int Run(string[] arguments,string input,string cwd,int timeoutMs,string cancelPath,string eventName,bool deferCancellation) {
    IntPtr inRead=IntPtr.Zero,inWrite=IntPtr.Zero,outRead=IntPtr.Zero,outWrite=IntPtr.Zero,errRead=IntPtr.Zero,errWrite=IntPtr.Zero;
    IntPtr job=IntPtr.Zero;PROCESS process=new PROCESS();EventWaitHandle cancel=null;
    Task stdout=null,stderr=null;
    try {
      if(!deferCancellation && !String.IsNullOrEmpty(eventName)) cancel=new EventWaitHandle(false,EventResetMode.ManualReset,eventName);
      if(!deferCancellation && ((!String.IsNullOrEmpty(cancelPath) && File.Exists(cancelPath)) || (cancel!=null && cancel.WaitOne(0)))) return 125;
      var security=new SA();security.length=Marshal.SizeOf(typeof(SA));security.inherit=1;
      Check(CreatePipe(out inRead,out inWrite,ref security,0));Check(SetHandleInformation(inWrite,1,0));
      Check(CreatePipe(out outRead,out outWrite,ref security,0));Check(SetHandleInformation(outRead,1,0));
      Check(CreatePipe(out errRead,out errWrite,ref security,0));Check(SetHandleInformation(errRead,1,0));
      job=CreateJobObject(IntPtr.Zero,null);Check(job!=IntPtr.Zero);
      var limits=new EXTENDED();limits.basic.flags=0x2000;Check(SetInformationJobObject(job,9,ref limits,Marshal.SizeOf(typeof(EXTENDED))));
      var startup=new STARTUP();startup.cb=Marshal.SizeOf(typeof(STARTUP));startup.flags=0x100;startup.input=inRead;startup.output=outWrite;startup.error=errWrite;
      var command=new StringBuilder();foreach(string argument in arguments) {if(command.Length>0) command.Append(' ');command.Append(Quote(argument));}
      Check(CreateProcess(null,command,IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,cwd,ref startup,out process));
      if(!AssignProcessToJobObject(job,process.process)) {TerminateProcess(process.process,1);Check(false);}
      Check(ResumeThread(process.thread)!=0xffffffff);CloseHandle(process.thread);process.thread=IntPtr.Zero;
      CloseHandle(inRead);inRead=IntPtr.Zero;CloseHandle(outWrite);outWrite=IntPtr.Zero;CloseHandle(errWrite);errWrite=IntPtr.Zero;
      var output=new FileStream(new SafeFileHandle(outRead,true),FileAccess.Read);outRead=IntPtr.Zero;
      var error=new FileStream(new SafeFileHandle(errRead,true),FileAccess.Read);errRead=IntPtr.Zero;
      stdout=Task.Run(()=>{using(output) output.CopyTo(Console.OpenStandardOutput());});
      stderr=Task.Run(()=>{using(error) error.CopyTo(Console.OpenStandardError());});
      using(var writer=new FileStream(new SafeFileHandle(inWrite,true),FileAccess.Write)) {
        inWrite=IntPtr.Zero;
        if(input!=null) {byte[] data=Encoding.UTF8.GetBytes(input);writer.Write(data,0,data.Length);}
      }
      var started=DateTime.UtcNow;int termination=0;
      while(WaitForSingleObject(process.process,50)==258) {
        bool cancelled=!deferCancellation && ((cancel!=null && cancel.WaitOne(0)) || (!String.IsNullOrEmpty(cancelPath) && File.Exists(cancelPath)));
        if(cancelled || (DateTime.UtcNow-started).TotalMilliseconds>timeoutMs) {termination=cancelled?125:124;TerminateJobObject(job,(uint)termination);break;}
      }
      WaitForSingleObject(process.process,5000);uint code;GetExitCodeProcess(process.process,out code);
      CloseHandle(job);job=IntPtr.Zero;Task.WaitAll(new Task[]{stdout,stderr},5000);
      return termination!=0?termination:(int)code;
    } finally {
      if(job!=IntPtr.Zero) CloseHandle(job);
      foreach(IntPtr handle in new IntPtr[]{inRead,inWrite,outRead,outWrite,errRead,errWrite,process.thread,process.process}) if(handle!=IntPtr.Zero) CloseHandle(handle);
      if(cancel!=null) cancel.Dispose();
    }
  }
}
'@
$inputValue = if ($null -eq $specification.input) { $null } else { [string]$specification.input }
$code = [ArchitectureManagerOwnedJob]::Run([string[]]$specification.argv, $inputValue, [string]$specification.cwd, [int]($specification.timeoutSeconds * 1000), [string]$specification.cancelPath, [string]$specification.cancelEvent, [bool]$specification.deferCancellation)
if ($managerCancelEvent) { $managerCancelEvent.Dispose() }
exit $code
