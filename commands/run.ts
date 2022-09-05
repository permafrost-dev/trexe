// deno-lint-ignore-file no-inner-declarations
/**
 * Copyright (c) Crew Dev.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

 import { parseToYaml } from '../tools/parse_to_yaml.ts';
 import { Match } from '../utils/file_resolver.ts';
 import type { runJson } from '../utils/types.ts';
 import { exists, readJson } from 'tools-fs';
 import { isGH } from '../utils/storage.ts';
 import * as colors from 'fmt/colors.ts';
 import { join } from 'path/mod.ts';
 
 const { red, yellow, green } = colors;
 const { env, run } = Deno;
 
 /**
  * execute a command
  * @param {string} runner
  * @param {string} cmd
  */
 function executeCommand(runner: string, cmd: string) {
     const process = run({
         cmd: [runner, 'run', ...cmd.split(' ')].map((command, index) =>
             command === 'deno' && (index === 0 || index === 1) ? ResolveDenoPath() : command,
         ),
         stderr: 'piped',
         stdout: 'inherit',
         env: env.toObject(),
         cwd: Deno.cwd(),
     });
 
     const [status] = await Promise.all([process.status()]);
 
     if (!(await process.status()).success) {
         Deno.close(process.rid);
         throw new Error(`Error: running command ${red(toRun[0])}`).message;
     }
 
     Deno.close(process.rid);
 }
 
const hasKey = (obj: any, key: string) => Object.keys(obj).includes(key);

 /**
  * execute subprocess script
  * @param command
  */
 export async function Run(command: string, runArgs: string[] = []) {
     let prefix = (await exists('./run.json')) ? 'json' : 'yaml';
 
     if (!(await exists('./run.json')) && !(await exists('./run.yaml')) && !(await exists('./run.yml'))) {
         throw new Error(red(`: ${yellow('run.json or run.yaml not found')}`)).message;
     }
 
     if ((await exists('./run.json')) && ((await exists('./run.yaml')) || (await exists('./run.yml')))) {
         throw new Error(red(`: ${yellow('use a single format run.json or run.yaml file')}`)).message;
     } else {
         async function Thread() {
             try {
                 const runJsonFile = await Scripts();
                 const denoTasks = await getDenoTasks();
                 const allScripts = { run: runJsonFile?.scripts || {}, tasks: denoTasks };
 
                 if (hasKey(denoTasks, command)) {
                   console.log('running deno task');
                   executeCommand('deno', [denoTasks[command], runArgs].join(' '));
                   return true;
                 }
 
                 if (Object.keys(allScripts.run).length === 0 && !Object.keys(allScripts.tasks).length) {
                     throw new Error(red(`: ${yellow(`the 'scripts' key not found in run.${prefix} file`)}`)).message;
                 }
 
                 const scripts = Object.keys(allScripts.run);
 
                 const toRun = allScripts.run.map(key => (key === command ? allScripts.run[key] : undefined)).filter(el => !!el) as string[];
 
                 if (!toRun.length) {
                     throw new Error(red(`: ${yellow('command not found')}`)).message;
                 }
                 // normalize command
                 const runnerCommand = toRun[0].split(' ').filter(arg => !!arg);
 
                 // github action fallback deno dir path
                 const ghFallBack = Match(Deno.build.os)
                     .case('darwin', () => '/Users/runner/.deno/bin')
                     .case('linux', () => '/home/runner/.deno/bin')
                     .case('windows', () => 'C:\\Users\\runneradmin\\.deno\\bin')
                     .default()
                     .Value() as string;
 
                 // get path to deno scripts
                 const scriptPath = isGH
                     ? ghFallBack
                     : Deno.build.os === 'windows'
                     ? // to windows base
                       join('C:', 'Users', env.get('USERNAME')!, '.deno', 'bin', runnerCommand[0])
                     : // to unix base
                       join(env.get('HOME')!, '.deno', 'bin', runnerCommand[0]);
 
                 // prevent deno scrips not found error
                 if ((await exists(scriptPath)) || (await exists(`${scriptPath}.cmd`))) {
                     if (Deno.build.os === 'linux' || Deno.build.os === 'darwin') {
                         runnerCommand[0] = scriptPath;
                     } else if (Deno.build.os === 'windows') {
                         runnerCommand[0] = `${runnerCommand[0]}.cmd`;
                     }
                 }
 
                 const [currentCMD, execCommand] = [
                     ['trex', 'run', command].join(' '),
                     [...runnerCommand]
                         .map(cmd => cmd?.trim())
                         .join(' ')
                         .replaceAll('.cmd', ''),
                 ];
 
                 const last = execCommand.split('/');
 
                 // remove path to compare on unix base os
                 const toCompare = Deno.build.os === 'linux' || Deno.build.os === 'darwin' ? last[last.length - 1] : execCommand;
 
                 // prevent circular call
                 if (currentCMD === toCompare) {
                     throw new EvalError(`${yellow('Circular call found in: ')}${red(toRun[0])}`).message;
                 }
 
                 const process = run({
                     cmd: [...runnerCommand, ...runArgs].map((command, index) =>
                         command === 'deno' && (index === 0 || index === 1) ? ResolveDenoPath() : command,
                     ),
                     stderr: 'piped',
                     stdout: 'inherit',
                     env: env.toObject(),
                     cwd: Deno.cwd(),
                 });
                 const [status] = await Promise.all([process.status()]);
 
                 if (!(await process.status()).success) {
                     Deno.close(process.rid);
                     throw new Error(`Error: running command ${red(toRun[0])}`).message;
                 }
 
                 Deno.close(process.rid);
             } catch (err) {
                 throw new Error(
                     err instanceof SyntaxError
                         ? red(`the ${yellow(`'run.${prefix}'`)} file not have a valid syntax`)
                         : err instanceof Deno.errors.NotFound
                         ? red(err.message)
                         : yellow(err.message ?? `${err}`),
                 ).message;
             }
         }
 
         const filesToWatch = prefix === 'json' ? ((await readJson('./run.json')) as runJson) : await parseToYaml();
 
         const watchFlags = Deno.args[2] === '--watch' || Deno.args[2] === '-w' || Deno.args[2] === '-wv';
 
         // run using trp (trex reboot protocol)
         if (filesToWatch?.files && watchFlags) {
             const files = filesToWatch.files.length ? [...filesToWatch.files] : ['.'];
 
             let throttle = 700;
             let timeout: number | null = null;
 
             function logMessages(verbose?: Deno.FsEvent) {
                 console.clear();
                 console.log(green('[Reboot protocol]'));
                 console.log(green('[*] watching files:'));
                 console.info(
                     red(
                         `[#] exit using ctrl+c \n ${
                             filesToWatch?.files?.length
                                 ? filesToWatch.files
                                       .map((file: string) => {
                                           console.log(' |- ', yellow(join(file)));
                                           return '';
                                       })
                                       .join('')
                                 : (console.log(` |- ${yellow('all files [ .* ]')}`) as undefined) ?? ''
                         } `,
                     ),
                 );
                 if (Deno.args[2] === '-wv' && verbose) {
                     console.log(
                         green(` ╭─ Verbose output ${yellow('-wv')}:\n`),
                         green(`│- Event Kind: ${yellow(verbose?.kind)}\n`),
                         green(`╰─ Path: ${yellow(verbose?.paths.join(''))}\n`),
                     );
                 }
             }
 
             logMessages();
             await Thread();
             for await (const event of Deno.watchFs(files, { recursive: true })) {
                 if (event.kind !== 'access') {
                     if (timeout) clearTimeout(timeout);
                     console.log(yellow('reloading...'));
                     logMessages(event);
                     timeout = setTimeout(Thread, throttle);
                 }
             }
         } // run a single exec thread
         else {
             await Thread();
         }
     }
 }
 
 /**
  * return run.json, run.yml .yaml info file
  */
 export async function Scripts() {
     let prefix = (await exists('./run.json')) ? 'json' : 'yaml';
     const runJsonFile = prefix === 'json' ? ((await readJson('./run.json')) as runJson) : await parseToYaml();
 
     return runJsonFile;
 }
 
 export async function getDenoTasks() {
     if (await exists('./deno.json')) {
         const denoJson = (await readJson('./deno.json')) as DenoJson;
 
         return denoJson['scripts'] || {};
     }
 
     return {};
 }
 
 /**
  * resolve deno bin path.
  */
 export function ResolveDenoPath() {
     let fallback = 'deno';
 
     switch (Deno.build.os) {
         case 'linux':
             fallback = `${Deno.env.get('HOME')}/.deno/bin/deno`;
             break;
         case 'darwin':
             // TODO(buttercubz) resolve macos path
             break;
         case 'windows':
             break;
     }
 
     return Deno.execPath() ?? fallback;
 }
 