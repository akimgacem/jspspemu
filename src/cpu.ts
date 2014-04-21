﻿class CpuBreakException implements Error {
    constructor(public name: string = 'CpuBreakException', public message: string = 'CpuBreakException') {
    }
}

interface InstructionUsage {
	name: string;
	count: number;
}

class FunctionGenerator {
	private instructions: core.cpu.Instructions = core.cpu.Instructions.instance;
	private instructionAst = new core.cpu.ast.InstructionAst();
	private instructionUsageCount: StringDictionary<number> = {};

	getInstructionUsageCount(): InstructionUsage[] {
		var items: InstructionUsage[] = [];
		for (var key in this.instructionUsageCount) {
			var value = this.instructionUsageCount[key];
			items.push({ name : key, count : value });
		}
		items.sort((a, b) => compareNumbers(a.count, b.count)).reverse();
		return items;
	}

	constructor(public memory: core.Memory) {
    }

    private decodeInstruction(address: number) {
		var instruction = core.cpu.Instruction.fromMemoryAndPC(this.memory, address);
        var instructionType = this.getInstructionType(instruction);
		return new core.cpu.DecodedInstruction(instruction, instructionType);
    }

	private getInstructionType(i: core.cpu.Instruction) {
        return this.instructions.findByData(i.data, i.PC);
    }

	private generateInstructionAstNode(di: core.cpu.DecodedInstruction):ANodeStm {
        var instruction = di.instruction;
        var instructionType = di.type;
        var func: Function = this.instructionAst[instructionType.name];
        if (func === undefined) throw (sprintf("Not implemented '%s' at 0x%08X", instructionType, di.instruction.PC));
        return func.call(this.instructionAst, instruction);
    }

	create(address: number) {
		if (address == 0x00000000) {
			throw(new Error("Trying to execute 0x00000000"));
		}

        var ast = new MipsAstBuilder();

        var PC = address;
        var stms: ANodeStm[] = [ast.functionPrefix()];

		var emitInstruction = () => {
            var result = this.generateInstructionAstNode(this.decodeInstruction(PC))
            PC += 4;
            return result;
        };

        for (var n = 0; n < 100000; n++) {
            var di = this.decodeInstruction(PC + 0);
			//console.log(di);

			if (this.instructionUsageCount[di.type.name] === undefined) {
				this.instructionUsageCount[di.type.name] = 0;
				console.warn('NEW instruction: ', di.type.name);
			}
			this.instructionUsageCount[di.type.name]++;
			
			//if ([0x089162F8, 0x08916318].contains(PC)) stms.push(ast.debugger(sprintf('PC: %08X', PC)));

            if (di.type.hasDelayedBranch) {
                var di2 = this.decodeInstruction(PC + 4);

                stms.push(emitInstruction());

                var delayedSlotInstruction = emitInstruction();
                if (di2.type.isSyscall) {
                    stms.push(this.instructionAst._postBranch(PC));
                    stms.push(this.instructionAst._likely(di.type.isLikely, delayedSlotInstruction));
                }
                else {
                    stms.push(this.instructionAst._likely(di.type.isLikely, delayedSlotInstruction));
                    stms.push(this.instructionAst._postBranch(PC));
                }

                break;
            } else {
                if (di.type.isSyscall) {
                    stms.push(this.instructionAst._storePC(PC + 4));
                }
                stms.push(emitInstruction());
				if (di.type.isBreak) {
					stms.push(this.instructionAst._storePC(PC));

                    break;
                }
            }
        }

        //console.debug(sprintf("// function_%08X:\n%s", address, ast.stms(stms).toJs()));

        if (n >= 100000) throw (new Error(sprintf("Too large function PC=%08X", address)));

        return new Function('state', ast.stms(stms).toJs());
    }
}

enum CpuSpecialAddresses {
    EXIT_THREAD = 0x0FFFFFFF,
}

class InstructionCache {
    functionGenerator: FunctionGenerator;
    private cache: any = {};

	constructor(public memory: core.Memory) {
        this.functionGenerator = new FunctionGenerator(memory);
    }

	invalidateAll() {
		this.cache = {};
	}

	invalidateRange(from: number, to: number) {
		for (var n = from; n < to; n += 4) delete this.cache[n];
    }

    getFunction(address: number) {
        var item = this.cache[address];
        if (item) return item;

        switch (address) {
            case CpuSpecialAddresses.EXIT_THREAD:
                return this.cache[address] = function (state: core.cpu.CpuState) {
					console.log(state);
					console.log(state.thread);
					console.warn('Thread: CpuSpecialAddresses.EXIT_THREAD: ' + state.thread.name);
					state.thread.stop();
                    throw(new CpuBreakException());
                };
                break;
            default: return this.cache[address] = this.functionGenerator.create(address);
        }
    }
}

class ProgramExecutor {
	private lastPC = 0;

	constructor(public state: core.cpu.CpuState, public instructionCache:InstructionCache) {
    }

	executeStep() {
		if (this.state.PC == 0) console.error(sprintf("Calling 0x%08X from 0x%08X", this.state.PC, this.lastPC));
		this.lastPC = this.state.PC;
		var func = this.instructionCache.getFunction(this.state.PC);
		func(this.state);
		//this.instructionCache.getFunction(this.state.PC)(this.state);
    }

    execute(maxIterations: number = -1) {
        try {
            while (maxIterations != 0) {
                this.executeStep();
                if (maxIterations > 0) maxIterations--;
            }
        } catch (e) {
            if (!(e instanceof CpuBreakException)) {
                console.log(this.state);
                throw (e);
            }
        }
    }
}
