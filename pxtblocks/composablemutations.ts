namespace pxt.blocks {
    export interface ComposableMutation {
        // Set to save mutations. Should return an XML element
        mutationToDom(mutationElement: Element): Element;
        // Set to restore mutations from save
        domToMutation(savedElement: Element): void;
    }

    export function appendMutation(block: Blockly.Block, mutation: ComposableMutation) {
        const b = block as MutatingBlock;

        const oldMTD = b.mutationToDom;
        const oldDTM = b.domToMutation;

        b.mutationToDom = () => {
            const el = oldMTD ? oldMTD() : document.createElement("mutation");
            return mutation.mutationToDom(el);
        };

        b.domToMutation = saved => {
            if (oldDTM) {
                oldDTM(saved);
            }
            mutation.domToMutation(saved);
        }
    }

    export function initVariableArgsBlock(b: Blockly.Block, handlerArgs: pxt.blocks.HandlerArg[]) {
        let currentlyVisible = 0;
        let actuallyVisible = 0;

        let i = b.appendDummyInput();

        let updateShape = () => {
            if (currentlyVisible === actuallyVisible) {
                return;
            }

            if (currentlyVisible > actuallyVisible) {
                const diff = currentlyVisible - actuallyVisible;
                for (let j = 0; j < diff; j++) {
                    const arg = handlerArgs[actuallyVisible + j];
                    i.insertFieldAt(i.fieldRow.length - 1, new Blockly.FieldVariable(arg.name), "HANDLER_" + arg.name);
                }
            }
            else {
                let diff = actuallyVisible - currentlyVisible;
                for (let j = 0; j < diff; j++) {
                    const arg = handlerArgs[actuallyVisible - j - 1];
                    i.removeField("HANDLER_" + arg.name);
                }
            }

            if (currentlyVisible >= handlerArgs.length) {
                i.removeField("_HANDLER_ADD");
            }
            else if (actuallyVisible >= handlerArgs.length) {
                addPlusButton();
            }

            actuallyVisible = currentlyVisible;
        };

        Blockly.Extensions.apply('inline-svgs', b, false);
        addPlusButton();

        appendMutation(b, {
            mutationToDom: (el: Element) => {
                el.setAttribute("numArgs", currentlyVisible.toString());

                for (let j = 0; j < currentlyVisible; j++) {
                    const varField = b.getField("HANDLER_" + handlerArgs[j].name);
                    let varName = varField && varField.getText();
                    el.setAttribute("arg" + j, varName);
                }

                return el;
            },
            domToMutation: (saved: Element) => {
                let numArgs = parseInt(saved.getAttribute("numargs"));
                currentlyVisible = Math.min(isNaN(numArgs) ? 0 : numArgs, handlerArgs.length);

                updateShape();

                for (let j = 0; j < currentlyVisible; j++) {
                    const varName = saved.getAttribute("arg" + j);
                    const fieldName = "HANDLER_" + handlerArgs[j].name;
                    if (b.getField(fieldName)) {
                        setVarFieldValue(b, fieldName, varName);
                    }
                }
            }
        });

        function addPlusButton() {
            i.appendField(new Blockly.FieldImage((b as any).ADD_IMAGE_DATAURI, 24, 24, false, lf("Add argument"),
                () => {
                    currentlyVisible = Math.min(currentlyVisible + 1, handlerArgs.length);
                    updateShape();
                }), "_HANDLER_ADD");
        }
    }

    export function initExpandableBlock(b: Blockly.Block, def: pxtc.ParsedBlockDef, comp: BlockCompileInfo, toggle: boolean, addInputs: () => void) {
        // Add numbers before input names to prevent clashes with the ones added
        // by BlocklyLoader. The number makes it an invalid JS identifier
        const buttonAddName = "0_add_button";
        const buttonRemName = "0_rem_button";
        const attributeName = "_expanded";
        const inputsAttributeName = "_input_init";

        const optionNames = def.parameters.map(p => p.name);
        const totalOptions = def.parameters.length;
        const buttonDelta = toggle ? totalOptions : 1;

        // These two variables are the "state" of the mutation
        let visibleOptions = 0;
        let inputsInitialized = false;

        let addShown = false;
        let remShown = false;

        Blockly.Extensions.apply('inline-svgs', b, false);

        const onFirstRender = () => {
            if (b.rendered && !b.workspace.isDragging()) {
                updateShape(0, undefined, true);
                updateButtons();

                // We don't need anything once the dom is initialized, so clean up
                b.workspace.removeChangeListener(onFirstRender);
            }
        };

        // Blockly only lets you hide an input once it is rendered, so we can't
        // hide the inputs in init() or domToMutation(). This will get called
        // whenever a change is made to the workspace (including after the first
        // block render) and then remove itself
        b.workspace.addChangeListener(onFirstRender);

        appendMutation(b, {
            mutationToDom: (el: Element) => {
                // The reason we store the inputsInitialized variable separately from visibleOptions
                // is because it's possible for the block to get into a state where all inputs are
                // initialized but they aren't visible (i.e. the user hit the - button). Blockly
                // gets upset if a block has a different number of inputs when it is saved and restored.
                el.setAttribute(attributeName, visibleOptions.toString());
                el.setAttribute(inputsAttributeName, inputsInitialized.toString());
                return el;
            },
            domToMutation: (saved: Element) => {
                if (saved.hasAttribute(inputsAttributeName) && saved.getAttribute(inputsAttributeName) == "true" && !inputsInitialized) {
                    initOptionalInputs();
                }

                if (saved.hasAttribute(attributeName)) {
                    const val = parseInt(saved.getAttribute(attributeName));
                    if (!isNaN(val)) {
                        if (inputsInitialized) {
                            visibleOptions = addDelta(val);
                        }
                        else {
                            updateShape(val, true);
                        }
                        return;
                    }
                }
            }
        });

        // Set skipRender to true if the block is still initializing. Otherwise
        // the inputs will render before their shadow blocks are created and
        // leave behind annoying artifacts
        function updateShape(delta: number, skipRender = false, force = false) {
            const newValue = addDelta(delta);
            if (!force && !skipRender && newValue === visibleOptions) return;

            visibleOptions = newValue;

            if (!inputsInitialized && visibleOptions > 0) {
                initOptionalInputs();
                if (!b.rendered) {
                    return;
                }
            }

            let optIndex = 0
            for (let i = 0; i < b.inputList.length; i++) {
                const input = b.inputList[i];
                if (Util.startsWith(input.name, optionalDummyInputPrefix)) {
                    // The behavior for dummy inputs (i.e. labels) is that whenever a parameter is revealed,
                    // all earlier labels are made visible as well. If the parameter is the last one in the
                    // block then all labels are made visible
                    setInputVisible(input, optIndex < visibleOptions || visibleOptions === totalOptions);
                }
                else if (Util.startsWith(input.name, optionalInputWithFieldPrefix) || optionNames.indexOf(input.name) !== -1) {
                    const visible = optIndex < visibleOptions;
                    setInputVisible(input, visible);
                    if (visible && input.connection && !(input.connection as any).isConnected() && !b.isInsertionMarker()) {
                        // FIXME: Could probably be smarter here, right now this does not respect
                        // any options passed to the child block. Need to factor that out of BlocklyLoader
                        const param = comp.definitionNameToParam[def.parameters[optIndex].name];
                        const shadowId = param.shadowBlockId || shadowBlockForType(param.type);
                        if (shadowId) {
                            const nb = b.workspace.newBlock(shadowId);
                            nb.setShadow(true);

                            // Because this function is sometimes called before the block is
                            // rendered, we need to guard these calls to initSvg and render
                            if (nb.initSvg) nb.initSvg();
                            input.connection.connect(nb.outputConnection);
                            if (nb.render) nb.render();
                        }
                    }
                    ++optIndex;
                }
            }

            updateButtons();
            if (!skipRender) b.render();
        }

        function addButton(name: string, uri: string, alt: string, delta: number) {
            b.appendDummyInput(name)
            .appendField(new Blockly.FieldImage(uri, 24, 24, false, alt, () => updateShape(delta)))
        }

        function updateButtons() {
            const showAdd = visibleOptions !== totalOptions;
            const showRemove = visibleOptions !== 0;

            if (!showAdd) {
                addShown = false;
                b.removeInput(buttonAddName, true);
            }
            if (!showRemove) {
                remShown = false;
                b.removeInput(buttonRemName, true);
            }

            if (showRemove && !remShown) {
                if (addShown) {
                    b.removeInput(buttonAddName, true);
                    addMinusButton();
                    addPlusButton();
                }
                else {
                    addMinusButton();
                }
            }

            if (showAdd && !addShown) {
                addPlusButton();
            }
        }

        function addPlusButton() {
            addShown = true;
            addButton(buttonAddName, (b as any).ADD_IMAGE_DATAURI, lf("Reveal optional arguments"), buttonDelta);
        }

        function addMinusButton() {
            remShown = true;
            addButton(buttonRemName, (b as any).REMOVE_IMAGE_DATAURI, lf("Hide optional arguments"), -1 * buttonDelta);
        }

        function initOptionalInputs() {
            inputsInitialized = true;
            addInputs();
            updateButtons();
        }

        function addDelta(delta: number) {
            return Math.min(Math.max(visibleOptions + delta, 0), totalOptions);
        }


        function setInputVisible(input: Blockly.Input, visible: boolean) {
            // If the block isn't rendered, Blockly will crash
            if (b.rendered) {
                input.setVisible(visible);
            }
        }
    }

    function shadowBlockForType(type: string) {
        switch (type) {
            case "number": return "math_number";
            case "boolean": return "logic_boolean"
            case "string": return "text";
        }

        if (isArrayType(type)) {
            return "lists_create_with";
        }

        return undefined;
    }
}