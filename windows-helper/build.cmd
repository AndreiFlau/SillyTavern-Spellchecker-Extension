@echo off
rem Builds st-spellcheck-helper.exe with the C# compiler included in every Windows install.
cd /d "%~dp0"
"%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /optimize /out:st-spellcheck-helper.exe SpellHelper.cs
