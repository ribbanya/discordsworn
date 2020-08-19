﻿const discord = require('discord.js');
const fs = require('fs');
const ws = require('ws');
const dateFormat = require('dateformat');

const { Client } = require('discord.js');
const client = new Client({ partials: ['MESSAGE', 'CHANNEL', 'REACTION'] });

client.on('message', onMsg);
client.on('error', (error) => {
    console.error(error);
    if (error.target instanceof ws) {
        if (error.target.readyState === ws.CLOSED) {
            reconnectDiscordClient();
        }
    }
});

const supportedCommands = [
    is_askTheOracle, is_rollActionDice,
    is_createNPC,
    is_trackProgress,
    sf_prompt,
    aw_rollMoveDice,
    helpMessage,
    reconnectDiscordClient, exitProcess
].reduce((sc, fn) => {
    sc[fn.name] = fn;
    return sc;
}, {}); //TODO separate module

const supportedArgs = {
    [is_askTheOracle.name]: [
        is_oracleLookupTable.name,
        sf_prompt.name,
        '0', '10', '25', '50', '75', '90', '100'
    ]
};

const supportedOracles = [null, 'multipleColumns', 'nested'];

const prefixes = ['.']; //TODO user settings

function syncParseJson(filename) {
    return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

const tokens = syncParseJson('tokens.json');
const oracles = parseOraclesJson(syncParseJson('oracles.json'));

const cmdJson = parseCmdJson(syncParseJson('commands.json'));

login();

function formatArg(arg) {
    return arg.toLowerCase().replace(/\s+/g, '-');
}

function parseCmdJson(json) {
    const cmdJumps = {};
    const cmdData = {};

    const isMissing = (array) => !array || array.length < 1;
    const keysIncludes = (object, key) => Object.keys(object).includes(key);

    const parseJumps = (cmdKey) => {

        const aliases = json[cmdKey].aliases;
        const listener = supportedCommands[cmdKey];

        if (isMissing(aliases)) {
            console.warn(
                `Command '${cmdKey}' does not have any aliases. ` +
                `Using '${cmdKey}' instead.`
            );
            cmdJumps[cmdKey] = listener;
        } else {
            aliases.forEach(alias => {
                if (cmdJumps.hasOwnProperty(alias)) {
                    console.warn(`'${cmdKey}' is attempting to assign duplicate alias '${alias}'. Skipping.`);
                    return;
                }
                alias = formatArg(alias);
                cmdJumps[alias] = listener;
            });
        }
    };

    const parseArgLabels = (cmdKey) => json[cmdKey].argLabels || null;

    const parseArgJumps = (cmdKey) => {
        const group = json[cmdKey].argAliases;

        if (isMissing(group)) return null;

        const argJumps = {};

        const keys = Object.keys(group);
        keys.forEach(key => {
            const list = group[key];
            if (isMissing(list)) return;
            if (!supportedArgs[cmdKey].includes(key)) {
                console.warn(
                    `Command ${cmdKey}'s argument '${key}'` +
                    'is not supported. Skipping aliases.'
                );
                return;
            }
            list.forEach(alias => {
                if (argJumps.hasOwnProperty(alias)) {
                    console.warn(`'${cmdKey}.${key}' is attempting to assign duplicate alias '${alias}'. Skipping.`);
                    return;
                }
                alias = formatArg(alias);
                argJumps[alias] = key;
            });
        });
        return argJumps;
    };

    Object.keys(json).forEach(cmdKey => {
        const cmd = json[cmdKey];
        if (!keysIncludes(supportedCommands, cmdKey)) {
            console.warn(
                `Command ${cmdKey} is not supported. Skipping command.`
            );
            return;
        }
        parseJumps(cmdKey);
        const argJumps = parseArgJumps(cmdKey);
        const argLabels = parseArgLabels(cmdKey);
        if (argJumps || argLabels || !isMissing(cmd.aliases) ||
            cmd.title || cmd.helpText || cmd.description ||
            cmd.requiresOwner) {
            cmdData[cmdKey] = {};
            const data = cmdData[cmdKey];
            if (argJumps) data.argJumps = argJumps;
            if (argLabels) data.argLabels = argLabels;
            if (!isMissing(cmd.aliases)) data.aliases = cmd.aliases;
            if (cmd.title) data.title = cmd.title;
            if (cmd.helpText) data.helpText = cmd.helpText;
            if (cmd.description) data.description = cmd.description;
            if (cmd.requiresOwner) data.requiresOwner = cmd.requiresOwner;
        }
    });

    return {
        cmdData: cmdData,
        cmdJumps: cmdJumps
    };
}

function parseOraclesJson(json) {
    json.map = {};
    root: for (let i = 0; i < json.length; i++) {
        const oracle = json[i];
        oracle.type = oracle.type || null;
        let identifier = `Oracle at index ${i}`;
        const warn = (s) => console.warn(`${identifier}` + s + ' Skipping.');
        {
            if (!oracle.title) {
                warn(' is missing a title field.');
                continue;
            }

            identifier = `Oracle '${oracle.title}' at index ${i}`;

            if (!supportedOracles.includes(oracle.type)) {
                warn(`'s type '${oracle.type}' is not supported.`);
                continue;
            }

            const results = oracle.results;
            {
                let d = oracle.d;
                if (d && !parseInt(d)) {
                    warn(`'s 'd' value ('${d}') is not an integer.`);
                    continue;
                }
                if (!d) d = 100;

                const keys = Object.keys(results);
                for (let i = 0; i < keys.length; i++) {
                    const key = parseInt(keys[i]);
                    const keyId = `'s results key '${key}'`;
                    if (!key) {
                        warn(`${keyId} is not an integer`);
                        continue root;
                    }

                    if (keyId < 1) {
                        warn(`${keyId} is below the minimum value (1).`);
                        continue root;
                    }
                    if (keyId > d) {
                        warn(`${keyId} is above the maximum (${d}).`);
                        continue root;
                    }
                }
            }

            if (!(results && typeof results === 'object')) {
                warn(' does not have any results.');
                continue;
            }
        }
        if (oracle.aliases && !(oracle.aliases instanceof Array)) {
            warn(' has an \'aliases\' definition but it is not an Array.');
            continue;
        }
        const mapOracle = (s) => {
            if (json.map.hasOwnProperty(s)) {
                warn(` is attempting to assign duplicate alias '${s}'. Skipping.`);
                return;
            }
            s = formatArg(s);
            json.map[s] = oracle;
        };

        const title = formatArg(oracle.title);
        mapOracle(title);
        if (oracle.aliases && oracle.aliases.length > 0) {
            oracle.aliases.forEach(e => mapOracle(e));
        }
    }
    return json;
}


function onMsg(msg) {
    if (msg.author.id === client.user.id) return; //Don't check messages from the bot

    const mention = new RegExp(`<@.?${client.user.id}>`, 'g'); 
    let content = msg.content.replace(mention, '')
        .replace(/ {2,}/, ' ').trim();
    {
        const hasPrefix = prefixes.find((prefix) => {
            if (content.startsWith(prefix)) {
                content = content.substring(prefix.length);
                return true;
            }
            return false;
        });
        const relevant = hasPrefix ||
            msg.mentions.has(client.user) ||
            msg.channel instanceof discord.DMChannel;

        if (!relevant) return; //If there's no prefix, @bot mention, and isn't a DM, this isn't a message for the bot.
    }

    const args = content.split(' ');
    const cmdKey = args[0].toLowerCase();
    const cmdFn = cmdJson.cmdJumps[cmdKey];

    if (!cmdFn) return;

    {
        const date = dateFormat(Date.now(), 'mm/dd/yy HH:MM:ss');
        const user = `${msg.author.username}#${msg.author.discriminator}`;
        console.info(`[${date}] ${user} (${msg.channel.type}): ${msg.content}`);
    }

    if (cmdJson.cmdData[cmdFn.name].requiresOwner &&
        msg.author.id != tokens.discord.ownerId) {
        msg.channel.send(`${msg.author} You don't have permission to do that!`);
        return;
    }

    try {
        msg.content = content;
        (cmdFn)(msg, cmdKey, args.slice(1));
        return;
    } catch (error) {
        let output = `${msg.author} Error: ${error.message}.`;
        const helpOutput = errorHelp(cmdKey);
        if (helpOutput) output += `\n${helpOutput}`;
        msg.channel.send(output);
        console.error(`Error encountered while handling '${msg.content}':`, error);
    }
}

const helpAlias = Object.entries(cmdJson.cmdJumps)
    .find(kvp => kvp[1] === helpMessage)[0];

function errorHelp(cmdKey, args) {
    if (!helpAlias) return null;
    if (args && args.length > 0) args = ` ${args.join(' ')}`;
    else args = '';
    return `Type \`${prefixes[0]}${helpAlias} ${cmdKey}${args}\` for help.`;
}

function is_askTheOracle(msg, cmdKey, args) {
    const chan = msg.channel;
    const data = cmdJson.cmdData[is_askTheOracle.name];
    const argJumps = data.argJumps;
    const argLabels = data.argLabels;

    let invalidArgsMsg =
        msg.author +
        ' A likelihood is required. Please use a whole number between ' +
        '0-100 or one of the following:\n' +
        Object.keys(argJumps).map(s => '`' + s + '`').join(', ');
    const helpOutput = errorHelp(cmdKey);
    if (helpOutput) invalidArgsMsg += `\n${helpOutput}`;

    if (args.length < 1) {
        chan.send(invalidArgsMsg);
        return;
    }
    if (matchArg(is_askTheOracle, args[0], is_oracleLookupTable)) {
        is_oracleLookupTable(msg, cmdKey, args.slice(1), args[0]);
        return;
    }
    if (matchArg(is_askTheOracle, args[0], sf_prompt)) {
        sf_prompt(msg, cmdKey, args.slice(1), args[0]);
        return;
    }

    let likelihood = args[0].toLowerCase();
    const odds = argJumps[likelihood] || Number(likelihood);
    if (odds == null || odds != ~~odds || odds < 0 || odds > 100) {
        chan.send(invalidArgsMsg);
        return;
    }

    likelihood = argLabels[odds];
    if (likelihood == null) {
        likelihood = `The result is **${odds}%** likely vs.`;
    } else {
        likelihood = `The result is ${likelihood} (**${odds}%**) vs.`;
    }
    const result = d(100);
    let output = `${likelihood} **${result}**…\n`;

    const comment = args.length > 1 ? args.slice(1).join(' ') : null;
    if (comment) output += `"${comment}"\n`;

    output += msg.author + ' ' +
        (result <= odds ? '**Yes**.' : '**No**.');
    chan.send(output);
}

function is_oracleLookupTable(msg, cmdKey, args, tableAlias) {
    const oracleNotFoundMsg =
        'Please specify an Oracle from the list:\n' +
        Object.keys(oracles.map).map(s => '`' + s + '`').join(', ');

    const helpOutput = errorHelp(cmdKey, [tableAlias]);

    if (args.length < 1) {
        let output = `${msg.author} ${oracleNotFoundMsg}`;
        if (helpOutput) output += `\n${helpOutput}`;
        msg.channel.send(output);
        return;
    }
    const oracleName = args[0].toLowerCase();
    const oracle = oracles.map[oracleName];
    if (!oracle) {
        let output = `${msg.author} Oracle \`${oracleName}\` not found. ` +
            `${oracleNotFoundMsg}`;
        if (helpOutput) output += `\n${helpOutput}`;
        msg.channel.send(output);
        return;
    }
    //TODO: Check for oracle.results
    let roll = d(oracle.d ? oracle.d : 100);
    let output = `Consulting the Oracle of **${oracle.title}** vs. **${roll}**…\n`;

    const comment = args.length > 1 ? args.slice(1).join(' ') : null;
    if (comment) output += `"${comment}"\n`;

    const lookup = (results, roll) => Object.keys(results).find(k => k >= roll);
    let key = lookup(oracle.results, roll);
    const value = oracle.results[key];
    const list = [];
    switch (oracle.type) {
    case null:
        output += `${msg.author} **${value}**.`;
        break;
    case 'multipleColumns':
        output += `${msg.author} `;
        for (let i = 0; i < oracle.results[key].length; i++) {
            let s = '';
            if (oracle.headers && i < oracle.headers.length) {
                s += `${oracle.headers[i]}: `;
            }
            s += `**${value[i]}**.`;
            list.push(s);
        }
        output += list.join(' ');
        break;
    case 'nested':
        roll = d(value.d ? value.d : 100); //TODO: Accept nested "d"
        output += `    **${value.title}** vs. **${roll}**…\n`;
        key = lookup(value.results, roll);
        output += `    _${value.prompt}_\n` +
            `${msg.author} **${value.results[key]}**.`;
        break;
    default:
        console.error(`Oracle '${oracle.title}' has unsupported type '${oracle.type}'.`);
    }
    msg.channel.send(output);
}

function resolveArg(cmdFn, argAlias) {
    return cmdJson.cmdData[cmdFn.name].argJumps[argAlias.toLowerCase()];
}

function matchArg(cmdFn, argAlias, argFn) {
    return resolveArg(cmdFn, argAlias) == argFn.name;
}

function d(sides, count = 1) {
    return rInt(1, sides, count);
}

function rInt(min, max, count = 1) {
    if (count == 1) return Math.floor(Math.random() * (max - min + 1)) + min;
    return Array.apply(null, Array(count)).map(() => rInt(min, max));
}

function is_rollActionDice(msg, cmdKey, args) {
    const chan = msg.channel;
    const mods = args.reduce((m, s) => {
        const i = parseInt(s);
        return m + (i ? i : 0);
    }, 0);
    const challenge = d(10, 2);
    const action = d(6);
    const challengeStr = challenge.map(n => (action + mods) > n ? `__${n}__` : n);
    const modStr = args.reduce((s, n) => {
        const i = parseInt(n);
        if (!i && i !== 0) return s;
        return s + (i < 0 ? '-' : '+') + Math.abs(i);
    }, '');

    let result = `**${action + mods}**`;
    if (modStr) result += ` (**${action}**${modStr})`;
    result += ` vs. **${challengeStr[0]}** & **${challengeStr[1]}**`;

    //let success = challenge.reduce(n => (action + mods) > n ? 1 : 0, 0);
    let success = 0;
    for (let i = 0; i < challenge.length; i++) {
        if (action + mods > challenge[i]) {
            success++;
        }
    }

    const successStr = ['Miss...', 'Weak hit!', '_Strong hit!_'][success];
    result += `\n${msg.author} ${successStr}`;

    if (challenge[0] == challenge[1]) result += ' _MATCH!_';
    chan.send(result);
}

function is_createNPC(msg, cmdKey, args) {
    //TODO: Add region, name type, and gender?    
    const chan = msg.channel;

    let role = internalOracleLookupTable("nr");
    let name = internalOracleLookupTable("in");
    let description = internalOracleLookupTable("nd");
    let goal = internalOracleLookupTable("g");

    let vowels = ["A", "E", "I", "O", "U", "a", "e", "i", "o", "u"];
    let a = "a";
    if (vowels.includes(role.slice(2,3))) {
        a = "an";
    } 

    chan.send(`The NPC is ${a} ${role} named ${name}. They are ${description} and want to ${goal}.`)
    .then(function(message) {
        var data = msg.channel.id + ',' + message.id + '\r\n';
 
        fs.appendFile('progressTrackers.csv', data, 'utf8',
            function(err) { 
                if (err) throw err;
        }); 

        message.react("💼")
        .then(() => message.react("🎯"))
        .then(() => message.react("🎭"))
        .then(() => message.react("🆔"))
        .then(() => message.react("🧝"))
        //.then(() => message.react("👽"))
    })
    .catch(() => console.error('One of the emojis failed to react.'));
}

function internalOracleLookupTable(tableName) {
    const oracleNotFoundMsg =
        'Please specify an Oracle from the list:\n' +
        Object.keys(oracles.map).map(s => '`' + s + '`').join(', ');

    let oracleName = tableName.toLowerCase();
    const oracle = oracles.map[oracleName];
    if (!oracle) {
        return `Oracle \`${oracleName}\` not found. ${oracleNotFoundMsg}`;
    }
    //TODO: Check for oracle.results
    let roll = d(oracle.d ? oracle.d : 100);
    let output = ``;

    const lookup = (results, roll) => Object.keys(results).find(k => k >= roll);
    let key = lookup(oracle.results, roll);
    const value = oracle.results[key];
    const list = [];
    switch (oracle.type) {
    case null:
        output += `**${value}**`;
        break;
    case 'multipleColumns':
        for (let i = 0; i < oracle.results[key].length; i++) {
            let s = '';
            if (oracle.headers && i < oracle.headers.length) {
                s += `${oracle.headers[i]}: `;
            }
            s += `**${value[i]}**`;
            list.push(s);
        }
        output += list.join(' ');
        break;
    case 'nested':
        roll = d(value.d ? value.d : 100); //TODO: Accept nested "d"
        output += `    **${value.title}** vs. **${roll}**…\n`;
        key = lookup(value.results, roll);
        output += `    _${value.prompt}_\n` +
            `**${value.results[key]}**`;
        break;
    default:
        console.error(`Oracle '${oracle.title}' has unsupported type '${oracle.type}'.`);
    }

    if (output == "**Roll twice**") {
        let result1 = internalOracleLookupTable(tableName);
        let result2 = internalOracleLookupTable(tableName);

        while (result1 == result2) { 
            result2 = internalOracleLookupTable(tableName);
        }

        output = `${result1} and ${result2}`;
    }
    return output;
}

function sf_prompt(msg, cmdKey, args, tableAlias) {
    const invalidArgsMsg = 'Please use a prompt name\n`Action`,`Theme`,`a/t`, `Descriptor`,`Focus`,`d/f`';
    
    if (args.length < 1) {
        msg.channel.send(invalidArgsMsg);
        return;
    }

    let promptName = args[0].toLowerCase();
    const actionTheme = ["action", "theme", "a/t", "action/theme"];
    const descriptorFocus = ["descriptor", "focus", "d/f", "descriptor/focus"];
    if (actionTheme.includes(promptName)) {
        let action = internalOracleLookupTable("sfa");
        let theme = internalOracleLookupTable("sft");
        msg.channel.send(`Your Prompt is: ${action}/${theme}`);
        return;
    }
    if (descriptorFocus.includes(promptName)) {
        let descriptor = internalOracleLookupTable("sfd");
        let focus = internalOracleLookupTable("sff");
        msg.channel.send(`Your Prompt is: ${descriptor}/${focus}`);
        return;
    }

    msg.channel.send(invalidArgsMsg);
}

function is_trackProgress(msg, cmdKey, args) {
    const rank = args[0];

    const invalidArgsMsg = 
        'Please specify a difficulty\n' +
        '`troublesome`,`dangerous`,`formidable`,`extreme`,`epic`';
    
    if (args.length < 1) {
        msg.channel.send(invalidArgsMsg);
        return;
    }

    const comment = args.length > 1 ? args.slice(1).join(' ').replace('\n') : 'Unnamed Tracker';
    let result = '```' + comment + '\n[··········] Current Value: 0/10 (' + rank + ')```';
    msg.channel.send(result)
    .then(function(message) {
        var data = msg.channel.id + ',' + message.id + '\r\n';
 
        fs.appendFile('progressTrackers.csv', data, 'utf8',
            function(err) { 
                if (err) throw err;
        }); 

        message.react("◀️")
        .then(() => message.react("▶️"))
        .then(() => message.react("#️⃣"))
        .then(() => message.react("🎲"))
        //.then(() => message.react("🚫"))
    })
    .catch(() => console.error('One of the emojis failed to react.'));
}

client.on('messageReactionAdd', async (reaction, user) => {
    if (user.id == client.user.id || reaction.message.author.id != client.user.id) return;

    if (reaction.emoji.name == '▶️') {
        let ticks = calculateTicks(reaction, 1, true);
        updateProgressTracker(reaction, ticks);
        reaction.users.remove(user.id).catch(console.error);
    }
    else if (reaction.emoji.name == '◀️') {
        let ticks = calculateTicks(reaction, -1, true);
        updateProgressTracker(reaction, ticks);
        reaction.users.remove(user.id).catch(console.error);
    }
    else if (reaction.emoji.name == '#️⃣') {
        let ticks = calculateTicks(reaction, 4, false);
        updateProgressTracker(reaction, ticks);
        reaction.users.remove(user.id).catch(console.error);
    }
    else if (reaction.emoji.name == '🎲') {
        rollProgress(reaction);
        reaction.users.remove(user.id).catch(console.error);
    }
    else if (reaction.emoji.name == '🆔') {
        renameNPC(reaction);
        reaction.users.remove(user.id).catch(console.error);    
    }
    else if (reaction.emoji.name == '🧝') {
        renameNPC(reaction);
        reaction.users.remove(user.id).catch(console.error);
    }
    else if (reaction.emoji.name == '🎭') {
        addDescriptor(reaction);
        reaction.users.remove(user.id).catch(console.error);
    }
    else if (reaction.emoji.name == '🎯') {
        addGoal(reaction);
        reaction.users.remove(user.id).catch(console.error);
    }
    else if (reaction.emoji.name == '💼') {
        addRole(reaction);
        reaction.users.remove(user.id).catch(console.error);
    }
    else if (reaction.emoji.name == '🚫') {
        reaction.message.delete().catch(console.error);    
    }
});

function rollProgress(reaction) {
    const challenge = d(10, 2);

    let amount = calculateTicks(reaction, 0, false);
    let fullMarks = Math.floor(amount / 4);
    
    const challengeStr = challenge.map(n => (fullMarks) > n ? `__${n}__` : n);

    let result = `Progress Roll\n**${fullMarks}**`;
    result += ` vs. **${challengeStr[0]}** & **${challengeStr[1]}**`;

    let success = 0;
    for (let i = 0; i < challenge.length; i++) {
        if (fullMarks > challenge[i]) {
            success++;
        }
    }

    const successStr = ['Miss...', 'Weak hit!', '_Strong hit!_'][success];
    result += `\n${user} ${successStr}`;

    if (challenge[0] == challenge[1]) result += ' _MATCH!_';
    reaction.message.channel.send(result);
}

function renameNPC(reaction) {
    let tableName = "";
    if (reaction.emoji.name == '🆔') tableName = "ironlander-names";
    if (reaction.emoji.name == '🧝') tableName = "elf-names";
    let newName = internalOracleLookupTable(tableName);
    let oldNameRegex = /(?<=named )([^.\r\n])*./;
    let newMessage = reaction.message.content.replace(oldNameRegex, `**${newName}**.`);
    reaction.message.edit(newMessage);
}

function addRole(reaction) {
    let newRole = internalOracleLookupTable("npc-role");
    let roleRegex = /(?<=The NPC is a ).*(?= named)/;
    let oldRole = reaction.message.content.match(roleRegex);
    reaction.message.edit(reaction.message.content.replace(oldRole, `${oldRole} and a ${newRole}`));
}

function addGoal(reaction) {
    let newGoal = internalOracleLookupTable("goals");
    let goalRegex = /(?<=want to ).*(?=\.)/;
    let oldGoalText = reaction.message.content.match(goalRegex);
    reaction.message.edit(reaction.message.content.replace(oldGoalText, `${oldGoalText} and ${newGoal}`));
}

function addDescriptor(reaction) {
    let newDesc = internalOracleLookupTable("npc-descriptors");
    let descRegex = /(?<=They are ).*(?=and want to)/;
    let oldDescText = reaction.message.content.match(descRegex);
    reaction.message.edit(reaction.message.content.replace(oldDescText, `${oldDescText}and ${newDesc} `));
}

const noTick = '·';
const singleTick = '-';
const doubleTick = 'x';
const tripleTick = '*';
const completedTick = '#';

function calculateTicks(reaction, amount, useRank) {
    let regexProgressBox = /\[.*\]/;
    let regexRank = /(troublesome|dangerous|formidable|extreme|epic)/;
    
    let progressBox = reaction.message.content.match(regexProgressBox);    
    let rank = reaction.message.content.match(regexRank)[0];

    let ticksToAdd = 1;
    if (useRank) {
        if (rank == 'troublesome') ticksToAdd = 12 * amount;       
        if (rank == 'dangerous') ticksToAdd = 8 * amount;       
        if (rank == 'formidable') ticksToAdd = 4 * amount;       
        if (rank == 'extreme') ticksToAdd = 2 * amount;       
        if (rank == 'epic') ticksToAdd = 1 * amount;
    } else {
        ticksToAdd = amount;
    }    

    let progressString = progressBox[0].replace('[', '').replace(']', '');
    let firstEmpty = progressString.search(noTick);

    let currentMarks;
    if (firstEmpty < 0) {
        currentMarks = 10;
    } else if (firstEmpty == 0) {
        currentMarks = 0;
    } else {
        currentMarks = firstEmpty - 1;
    }

    let inProgressMarkValue = 0;
    switch (progressString.substr(currentMarks, 1)) {
        case singleTick:
            inProgressMarkValue = 1;
            break;
        case doubleTick:
            inProgressMarkValue = 2;
            break;
        case tripleTick:
            inProgressMarkValue = 3;
            break;
        case completedTick:
            inProgressMarkValue = 4;
            break;
    }

    let currentTick = 0;
    if (currentMarks > 0) {
        currentTick = currentMarks * 4;
    }
    currentTick += inProgressMarkValue;

    let finalTicks = currentTick + ticksToAdd;
    //Min and max checks
    if (finalTicks > 40) finalTicks = 40;
    if (finalTicks < 0) finalTicks = 0;

    return finalTicks;
}

function updateProgressTracker(reaction, finalTicks) {
    let fullMarks = Math.floor(finalTicks / 4);
    let partialMarks = (finalTicks % 4);

    let progressCharacters = completedTick.repeat(fullMarks);
    if (partialMarks == 1) progressCharacters += singleTick; 
    if (partialMarks == 2) progressCharacters += doubleTick; 
    if (partialMarks == 3) progressCharacters += tripleTick; 

    let regexProgressValue = /\d\d?\/10/
    let regexProgressBox = /\[.*\]/;

    let newBox = `[${progressCharacters}${noTick.repeat(10 - progressCharacters.length)}]`;
    let newValue = `${fullMarks}/10`;
    let newContent = reaction.message.content.replace(regexProgressBox, newBox).replace(regexProgressValue, newValue);

    reaction.message.edit(newContent);
}

//Load the saved messages
client.on('ready', () => {
    const readline = require('readline');

    async function processLineByLine() {
        const fileStream = fs.createReadStream('progressTrackers.csv');

        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        let counter = 0;
        for await (const line of rl) {            
            let input = line.split(',');
            if (input.length < 2) return;

            let channelId = input[0];
            let messageId = input[1];

            if (!client.channels.cache.some(channel => channel.id === channelId)) continue;

            try {
                let channel = client.channels.cache.get(channelId);
                channel.messages.fetch(messageId);
                counter++;
            } catch (error) {
                console.error(error.message);
            }
        }
        console.log(`Fetched ${counter} messages.`);
        return;
    }

    var lineByLine = processLineByLine();
    lineByLine.then(console.log('Ready.'));
});

process.on('unhandledRejection', (console.error));


function aw_rollMoveDice(msg, cmdKey, args) {
    const chan = msg.channel;
    const mods = args.reduce((m, s) => {
        const i = parseInt(s);
        return m + (i ? i : 0);
    }, 0);
    const action = d(6, 2);
    const total = action[0] + action[1] + mods;
    const modStr = args.reduce((s, n) => {
        const i = parseInt(n);
        if (!i && i !== 0) return s;
        return s + ' ' + (i < 0 ? '-' : '+') + ' ' + Math.abs(i);
    }, '');
    let result = '' +
        `**${total}** (**${action[0]}** & **${action[1]}**${modStr})`;

    let success;
    if (total <= 6) success = 0;
    else if (total <= 9) success = 1;
    else success = 2;
    const successStr = ['Miss...', 'Mixed success!', '_Success!_'][success];
    result += `\n${msg.author} ${successStr}`;

    chan.send(result);
}

function login() {
    client.login(tokens.discord.botAccount);
}

function reconnectDiscordClient(msg, _cmdKey, _args) {
    const a = msg.author;

    console.info(`Reset request received from ${a.id} (${a.username}#${a.discriminator}).`);
    console.log('Resetting.');

    msg.channel.send(`Resetting at the request of ${a}.`)
        .then(() => client.destroy())
        .then(() => login());
}

function exitProcess(msg, _cmdKey, _args) {
    const a = msg.author;

    console.info(`Shutdown request received from ${a.id} (${a.username}#${a.discriminator}).`);
    console.log('Shutting down.');

    msg.channel.send(`Shutting down at the request of ${a}.`)
        .then(() => client.destroy())
        .then(() => process.exit(0));
}


const helpSymbols = (() => {
    const symbols = {
        helpList: (msg) => {
            return Object.keys(cmdJson.cmdData).reduce((s, cmdKey) => {
                // if (cmdKey === helpMessage.name) return s;

                const cmd = cmdJson.cmdData[cmdKey];

                let marker = '';
                if (cmd.requiresOwner) {
                    if (!isOwner(msg.author)) return s;

                    marker = '&';
                }
                const aliases = cmd.aliases.map(alias => '`' + alias + '`').join(', ');
                if (s) s += '\n\n';
                return s + `${aliases}\n${marker}**${cmd.title}**\n    ${cmd.description}`;
            }, '');
        },
        selfPing: (_msg) => client.user.toString()

    };

    return Object.keys(symbols).reduce((result, key) => {
        const regexp = new RegExp('\\${' + key + '}', 'gm');
        result.push({
            regexp: regexp,
            function: symbols[key]
        });
        return result;
    }, []);
})();

function helpMessage(msg, _cmdKey, args) {
    let helpFn = args && args.length > 0 ?
        cmdJson.cmdJumps[args[0]] : helpMessage;

    let output = `${msg.author}`;

    if (!helpFn) {
        output += ` Command \`${args[0]}\` not recognized.`;
        helpFn = helpMessage;
    }

    let helpText = cmdJson.cmdData[helpFn.name].helpText;
    if (!helpText) helpText = '_(No documentation)_';


    helpSymbols.forEach(symbol => {
        if (!symbol.regexp.test(helpText)) return;
        const result = symbol['function'](msg);
        helpText = helpText.replace(symbol.regexp, result);
    });

    output += '\n' + helpText;

    msg.channel.send(output);
}

function isOwner(user) {
    return user.id === tokens.discord.ownerId;
}