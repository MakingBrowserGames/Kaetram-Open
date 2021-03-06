/* global module */

let Packets = require('../network/packets'),
    Request = require('request'),
    config = require('../../config.json'),
    _ = require('underscore'),
    Messages = require('../network/messages'),
    sanitizer = require('sanitizer'),
    Commands = require('./commands'),
    Items = require('../util/items'),
    Creator = require('../database/mongodb/creator'),
    Utils = require('../util/utils');

class Incoming {

    constructor(player) {
        let self = this;

        self.player = player;
        self.connection = self.player.connection;
        self.world = self.player.world;
        self.database = self.player.database;
        self.commands = new Commands(self.player);

        self.connection.listen((data) => {

            let packet = data.shift(),
                message = data[0];

            if (!Utils.validPacket(packet)) {

                log.error('Non-existent packet received: ' + packet + ' data: ');
                log.error(message);

                return;
            }

            self.player.refreshTimeout();

            switch(packet) {

                case Packets.Intro:
                    self.handleIntro(message);
                    break;

                case Packets.Ready:
                    self.handleReady(message);
                    break;

                case Packets.Who:
                    self.handleWho(message);
                    break;

                case Packets.Equipment:
                    self.handleEquipment(message);
                    break;

                case Packets.Movement:
                    self.handleMovement(message);
                    break;

                case Packets.Request:
                    self.handleRequest(message);
                    break;

                case Packets.Target:
                    self.handleTarget(message);
                    break;

                case Packets.Combat:
                    self.handleCombat(message);
                    break;

                case Packets.Projectile:
                    self.handleProjectile(message);
                    break;

                case Packets.Network:
                    self.handleNetwork(message);
                    break;

                case Packets.Chat:
                    self.handleChat(message);
                    break;

                case Packets.Inventory:
                    self.handleInventory(message);
                    break;

                case Packets.Bank:
                    self.handleBank(message);
                    break;

                case Packets.Respawn:
                    self.handleRespawn(message);
                    break;

                case Packets.Trade:
                    self.handleTrade(message);
                    break;

                case Packets.Enchant:
                    self.handleEnchant(message);
                    break;

                case Packets.Click:
                    self.handleClick(message);
                    break;

                case Packets.Warp:
                    self.handleWarp(message);
                    break;

                case Packets.Shop:
                    self.handleShop(message);
                    break;

                case Packets.Region:
                    self.handleRegion(message);
                    break;

                case Packets.Camera:
                    self.handleCamera(message);
                    break;

            }

        });
    }

    handleIntro(message) {
        let self = this,
            loginType = message.shift(),
            username = message.shift().toLowerCase(),
            password = message.shift(),
            isRegistering = loginType === Packets.IntroOpcode.Register,
            isGuest = loginType === Packets.IntroOpcode.Guest,
            email = isRegistering ? message.shift() : '',
            formattedUsername = username ? username.charAt(0).toUpperCase() + username.slice(1) : '';

        self.player.username = formattedUsername.substr(0, 32).trim().toLowerCase();
        self.player.password = password.substr(0, 32);
        self.player.email = email.substr(0, 128).toLowerCase();

        if (self.introduced)
            return;

        if (self.world.playerInWorld(self.player.username)) {
            self.connection.sendUTF8('loggedin');
            self.connection.close('Player already logged in..');
            return;
        }

        if (config.overrideAuth) {
            self.database.login(self.player);
            return;
        }

        if (config.offlineMode) {
            let creator = new Creator(null);

            self.player.load(Creator.getFullData(self.player));
            self.player.intro();

            return;
        }

        self.introduced = true;

        if (isRegistering) {
            self.database.exists(self.player, (result) => {
                if (result.exists) {
                    self.connection.sendUTF8(result.type + 'exists');
                    self.connection.close(result.type + ' is not available.');
                } else
                    self.database.register(self.player);
            });

        } else if (isGuest) {

            self.player.username = 'Guest' + Utils.randomInt(0, 2000000);
            self.player.password = null;
            self.player.email = null;
            self.player.isGuest = true;

            self.database.login(self.player);

        } else
            self.database.verify(self.player, (result) => {
                if (result.status === 'success')
                    self.database.login(self.player);
                else {
                    self.connection.sendUTF8('invalidlogin');
                    self.connection.close('Wrong password entered for: ' + self.player.username);
                }
            });


    }

    handleReady(message) {
        let self = this,
            isReady = message.shift(),
            preloadedData = message.shift(),
            userAgent = message.shift();

        if (!isReady)
            return;

        if (self.player.regionsLoaded.length > 0 && !preloadedData)
            self.player.regionsLoaded = [];

        self.player.ready = true;

        self.world.region.handle(self.player);
        self.world.region.push(self.player);

        self.player.sendEquipment();
        self.player.loadInventory();
        self.player.loadQuests();

        if (self.world.map.isOutOfBounds(self.player.x, self.player.y))
            self.player.setPosition(50, 89);

        if (self.player.userAgent !== userAgent) {

            self.player.userAgent = userAgent;

            self.player.regionsLoaded = [];
            self.player.updateRegion(true);
        }

        self.player.save();

        if (self.player.readyCallback)
            self.player.readyCallback();

        self.player.sync();
    }

    handleWho(message) {
        let self = this;

        _.each(message.shift(), (id) => {
            let entity = self.world.getEntityByInstance(id);

            if (entity && entity.id && !entity.dead)
                self.player.send(new Messages.Spawn(entity));
        });
    }

    handleEquipment(message) {
        let self = this,
            opcode = message.shift();

        switch (opcode) {

            case Packets.EquipmentOpcode.Unequip:
                let type = message.shift();

                if (!self.player.inventory.hasSpace()) {
                    self.player.send(new Messages.Notification(Packets.NotificationOpcode.Text, 'You do not have enough space in your inventory.'));
                    return;
                }

                switch (type) {
                    case 'weapon':

                        if (!self.player.hasWeapon())
                            return;

                        self.player.inventory.add(self.player.weapon.getItem());
                        self.player.setWeapon(-1, -1, -1, -1);

                        break;

                    case 'armour':
                        if (self.player.hasArmour() && self.player.armour.id === 114)
                            return;

                        self.player.inventory.add(self.player.armour.getItem());
                        self.player.setArmour(114, 1, -1, -1);

                        break;

                    case 'pendant':

                        if (!self.player.hasPendant())
                            return;

                        self.player.inventory.add(self.player.pendant.getItem());
                        self.player.setPendant(-1, -1, -1, -1);

                        break;

                    case 'ring':

                        if (!self.player.hasRing())
                            return;

                        self.player.inventory.add(self.player.ring.getItem());
                        self.player.setRing(-1, -1, -1, -1);

                        break;

                    case 'boots':

                        if (!self.player.hasBoots())
                            return;

                        self.player.inventory.add(self.player.boots.getItem());
                        self.player.setBoots(-1, -1, -1, -1);

                        break;
                }

                self.player.send(new Messages.Equipment(Packets.EquipmentOpcode.Unequip, [type]));
                self.player.sync();

                break;
        }
    }

    handleMovement(message) {
        let self = this,
            opcode = message.shift(),
            orientation;

        if (!self.player || self.player.dead)
            return;

        switch (opcode) {
            case Packets.MovementOpcode.Request:
                let requestX = message.shift(),
                    requestY = message.shift(),
                    playerX = message.shift(),
                    playerY = message.shift();

                if (self.preventNoClip(requestX, requestY))
                    self.player.guessPosition(requestX, requestY);

                self.player.movementStart = new Date().getTime();

                break;

            case Packets.MovementOpcode.Started:
                let selectedX = message.shift(),
                    selectedY = message.shift(),
                    pX = message.shift(),
                    pY = message.shift(),
                    movementSpeed = message.shift();

                if (!movementSpeed || movementSpeed != self.player.movementSpeed)
                    self.player.incrementCheatScore(1);

                if (pX !== self.player.x || pY !== self.player.y || self.player.stunned || !self.preventNoClip(selectedX, selectedY))
                    return;

                self.player.moving = true;

                break;

            case Packets.MovementOpcode.Step:
                let x = message.shift(),
                    y = message.shift();

                if (self.player.stunned || !self.preventNoClip(x, y))
                    return;

                self.player.setPosition(x, y);

                break;

            case Packets.MovementOpcode.Stop:
                let posX = message.shift(),
                    posY = message.shift(),
                    id = message.shift(),
                    hasTarget = message.shift(),
                    entity = self.world.getEntityByInstance(id);

                if (!self.player.moving) {

                    if (config.debug)
                        log.info(`[Warning] Did not receive movement start packet for ${self.player.username}.`);

                    self.player.incrementCheatScore(1);
                }

                orientation = message.shift();

                if (entity && entity.type === 'item')
                    self.player.inventory.add(entity);

                if (self.world.map.isDoor(posX, posY) && !hasTarget) {
                    let destination = self.world.map.getDoorDestination(posX, posY);

                    self.player.teleport(destination.x, destination.y, true);
                } else {
                    self.player.setPosition(posX, posY);
                    self.player.setOrientation(orientation);
                }

                self.player.moving = false;
                self.player.lastMovement = new Date().getTime();

                let diff = self.player.lastMovement - self.player.movementStart;

                if (diff < self.player.movementSpeed)
                    self.player.incrementCheatScore(1);

                break;

            case Packets.MovementOpcode.Entity:

                let instance = message.shift(),
                    entityX = message.shift(),
                    entityY = message.shift(),
                    oEntity = self.world.getEntityByInstance(instance);

                if (!oEntity || (oEntity.x === entityX && oEntity.y === entityY))
                    return;

                oEntity.setPosition(entityX, entityY);

                if (oEntity.hasTarget())
                    oEntity.combat.forceAttack();

                break;

            case Packets.MovementOpcode.Orientate:
                orientation = message.shift();

                self.world.push(Packets.PushOpcode.Regions, {
                    regionId: self.player.region,
                    message: new Messages.Movement(Packets.MovementOpcode.Orientate, [self.player.instance, orientation])
                });

                break;

            case Packets.MovementOpcode.Freeze:
                /**
                 * Just used to prevent player from following entities in combat.
                 * This is primarily for the 'hold-position' functionality.
                 */

                self.player.frozen = message.shift();

                break;

            case Packets.MovementOpcode.Zone:
                let direction = message.shift();

                log.info('Player zoned - ' + direction);

                break;
        }
    }

    handleRequest(message) {
        let self = this,
            id = message.shift();

        if (id !== self.player.instance)
            return;

        self.world.region.push(self.player);
    }

    handleTarget(message) {
        let self = this,
            opcode = message.shift(),
            instance = message.shift();

        log.debug('Targeted: ' + instance);

        switch (opcode) {

            case Packets.TargetOpcode.Talk:
                let entity = self.world.getEntityByInstance(instance);

                if (!entity || !self.player.isAdjacent(entity))
                    return;

                self.player.cheatScore = 0;

                if (entity.type === 'chest') {
                    entity.openChest();
                    return;
                }

                if (entity.dead)
                    return;

                if (self.player.npcTalkCallback)
                    self.player.npcTalkCallback(entity);

                break;

            case Packets.TargetOpcode.Attack:

                let target = self.world.getEntityByInstance(instance);

                if (!target || target.dead || !self.canAttack(self.player, target))
                    return;

                self.player.cheatScore = 0;

                self.world.push(Packets.PushOpcode.Regions, {
                    regionId: target.region,
                    message: new Messages.Combat(Packets.CombatOpcode.Initiate, {
                        attackerId: self.player.instance,
                        targetId: target.instance
                    })
                });

                break;

            case Packets.TargetOpcode.None:

                self.player.combat.stop();
                self.player.removeTarget();

                break;
        }
    }

    handleCombat(message) {
        let self = this,
            opcode = message.shift();

        switch (opcode) {
            case Packets.CombatOpcode.Initiate:
                let attacker = self.world.getEntityByInstance(message.shift()),
                    target = self.world.getEntityByInstance(message.shift());

                if (!target || target.dead || !attacker || attacker.dead || !self.canAttack(attacker, target))
                    return;

                attacker.setTarget(target);

                if (!attacker.combat.started)
                    attacker.combat.forceAttack();
                else {

                    attacker.combat.start();

                    attacker.combat.attack(target);

                }

                if (target.combat)
                    target.combat.addAttacker(attacker);

                break;
        }
    }

    handleProjectile(message) {
        let self = this,
            type = message.shift();

        switch (type) {
            case Packets.ProjectileOpcode.Impact:
                let projectile = self.world.getEntityByInstance(message.shift()),
                    target = self.world.getEntityByInstance(message.shift());

                if (!target || target.dead || !projectile)
                    return;

                self.world.handleDamage(projectile.owner, target, projectile.damage);
                self.world.removeProjectile(projectile);

                if (target.combat.started || target.dead || target.type !== 'mob')
                    return;

                target.begin(projectile.owner);

                break;
        }
    }

    handleNetwork(message) {
        let self = this,
            opcode = message.shift();

        switch (opcode) {
            case Packets.NetworkOpcode.Pong:
                log.info('Pingy pongy pung pong.');
                break;
        }
    }

    handleChat(message) {
        let self = this,
            text = sanitizer.escape(sanitizer.sanitize(message.shift()));

        if (!text || text.length < 1 || !(/\S/.test(text)))
            return;

        if (text.charAt(0) === '/' || text.charAt(0) === ';')
            self.commands.parse(text);
        else {

            if (self.player.isMuted()) {
                self.player.send(new Messages.Notification(Packets.NotificationOpcode.Text, 'You are currently muted.'));
                return;
            }

            if (!self.player.canTalk) {
                self.player.send(new Messages.Notification(Packets.NotificationOpcode.Text, 'You are not allowed to talk for the duration of this event.'));
                return;
            }

            if (config.debug)
                log.info(`${self.player.username} - ${text}`);

            self.world.push(Packets.PushOpcode.Regions, {
                regionId: self.player.region,
                message: new Messages.Chat({
                    id: self.player.instance,
                    name: self.player.username,
                    withBubble: true,
                    text: text,
                    duration: 7000
                })
            });

        }

    }

    handleInventory(message) {
        let self = this,
            opcode = message.shift(),
            id, ability, abilityLevel;

        switch (opcode) {
            case Packets.InventoryOpcode.Remove:
                let item = message.shift(),
                    count;

                if (!item)
                    return;

                if (item.count > 1)
                    count = message.shift();

                id = Items.stringToId(item.string);

                let iSlot = self.player.inventory.slots[item.index];

                if (iSlot.id < 1)
                    return;

                if (count > iSlot.count)
                    count = iSlot.count;

                ability = iSlot.ability, abilityLevel = iSlot.abilityLevel;

                if (self.player.inventory.remove(id, count ? count : item.count, item.index))
                    self.world.dropItem(id, count ? count : 1, self.player.x, self.player.y, ability, abilityLevel);

                break;

            case Packets.InventoryOpcode.Select:
                let index = message.shift(),
                    slot = self.player.inventory.slots[index],
                    string = slot.string,
                    sCount = slot.count;

                ability = slot.ability,
                abilityLevel = slot.abilityLevel;

                if (!slot || slot.id < 1)
                    return;

                id = Items.stringToId(slot.string);

                if (slot.equippable) {

                    if (!self.player.canEquip(string))
                        return;

                    self.player.inventory.remove(id, slot.count, slot.index);

                    self.player.equip(string, sCount, ability, abilityLevel);

                } else if (slot.edible) {

                    self.player.inventory.remove(id, 1, slot.index);

                    self.player.eat(id);

                }

                break;
        }
    }

    handleBank(message) {
        let self = this,
            opcode = message.shift();

        switch (opcode) {
            case Packets.BankOpcode.Select:
                let type = message.shift(),
                    index = message.shift(),
                    isBank = type === 'bank';

                if (isBank) {
                    let bankSlot = self.player.bank.slots[index];

                    if (bankSlot.id < 1)
                        return;

                    //Infinite stacks move all at onces, otherwise move one by one.
                    let moveAmount = Items.maxStackSize(bankSlot.id) === -1 ? bankSlot.count : 1;

                    if (self.player.inventory.add(bankSlot,moveAmount))
                        self.player.bank.remove(bankSlot.id, moveAmount, index);

                } else {
                    let inventorySlot = self.player.inventory.slots[index];

                    if (inventorySlot.id < 1)
                        return;

                    if (self.player.bank.add(inventorySlot.id, inventorySlot.count, inventorySlot.ability, inventorySlot.abilityLevel))
                        self.player.inventory.remove(inventorySlot.id, inventorySlot.count, index);
                }

                break;
        }
    }

    handleRespawn(message) {
        let self = this,
            instance = message.shift();

        if (self.player.instance !== instance)
            return;

        let spawn = self.player.getSpawn();

        self.player.dead = false;
        self.player.setPosition(spawn.x, spawn.y);

        self.world.push(Packets.PushOpcode.Regions, {
            regionId: self.player.region,
            message: new Messages.Spawn(self.player),
            ignoreId: self.player.instance
        })

        self.player.send(new Messages.Respawn(self.player.instance, self.player.x, self.player.y));

        self.player.revertPoints();
    }

    handleTrade(message) {
        let self = this,
            opcode = message.shift(),
            oPlayer = self.world.getEntityByInstance(message.shift());

        if (!oPlayer || !opcode)
            return;

        switch (opcode) {
            case Packets.TradeOpcode.Request:

                break;

            case Packets.TradeOpcode.Accept:

                break;

            case Packets.TradeOpcode.Decline:

                break;
        }
    }

    handleEnchant(message) {
        let self = this,
            opcode = message.shift();

        switch (opcode) {
            case Packets.EnchantOpcode.Select:
                let index = message.shift(),
                    item = self.player.inventory.slots[index],
                    type = 'item';

                if (item.id < 1)
                    return;

                if (Items.isShard(item.id))
                    type = 'shards';

                self.player.enchant.add(type, item);

                break;

            case Packets.EnchantOpcode.Remove:

                self.player.enchant.remove(message.shift());

                break;

            case Packets.EnchantOpcode.Enchant:

                self.player.enchant.enchant();

                break;
        }
    }

    handleClick(message) {
        let self = this,
            type = message.shift(),
            state = message.shift();

        switch (type) {
            case 'profile':

                self.player.toggleProfile(state);

                break;

            case 'inventory':

                self.player.toggleInventory(state);

                break;

            case 'warp':

                self.player.toggleWarp(state);

                break;
        }
    }

    handleWarp(message) {
        let self = this,
            id = parseInt(message.shift()) - 1;

        if (self.player.warp)
            self.player.warp.warp(id);
    }

    handleShop(message) {
        let self = this,
            opcode = message.shift(),
            npcId = message.shift();

        switch (opcode) {
            case Packets.ShopOpcode.Buy:
                let buyId = message.shift(),
                    amount = message.shift();

                if (!buyId || !amount) {
                    self.player.notify('Incorrect purchase packets.');
                    return;
                }

                log.debug('Received Buy: ' + npcId + ' ' + buyId + ' ' + amount);

                self.world.shops.buy(self.player, npcId, buyId, amount);

                break;

            case Packets.ShopOpcode.Sell:

                if (!self.player.selectedShopItem) {
                    self.player.notify('No item has been selected.');
                    return;
                }

                self.world.shops.sell(self.player, npcId, self.player.selectedShopItem.index);

                break;

            case Packets.ShopOpcode.Select:
                let slotId = message.shift();

                if (!slotId) {
                    self.player.notify('Incorrect purchase packets.');
                    return;
                }

                slotId = parseInt(slotId);

                /**
                 * Though all this could be done client-sided
                 * it's just safer to send it to the server to sanitize data.
                 * It also allows us to add cheat checks in the future
                 * or do some fancier stuff.
                 */

                let item = self.player.inventory.slots[slotId];

                if (!item || item.id < 1)
                    return;

                if (self.player.selectedShopItem)
                    self.world.shops.remove(self.player);

                let currency = self.world.shops.getCurrency(npcId);

                if (!currency)
                    return;

                self.player.send(new Messages.Shop(Packets.ShopOpcode.Select, {
                    id: npcId,
                    slotId: slotId,
                    currency: Items.idToString(currency),
                    price: self.world.shops.getSellPrice(npcId, item.id)
                }));

                self.player.selectedShopItem = {
                    id: npcId,
                    index: item.index
                };

                log.debug('Received Select: ' + npcId + ' ' + slotId);

                break;

            case Packets.ShopOpcode.Remove:

                self.world.shops.remove(self.player);

                break;
        }
    }

    handleCamera(message) {
        let self = this;

        log.info(self.player.x + ' ' + self.player.y);

        self.player.cameraArea = null;
        self.player.handler.detectCamera(self.player.x, self.player.y);
    }

    canAttack(attacker, target) {

        /**
         * Used to prevent client-sided manipulation. The client will send the packet to start combat
         * but if it was modified by a presumed hacker, it will simply cease when it arrives to this condition.
         */

        if (attacker.type === 'mob' || target.type === 'mob')
            return true;

        return attacker.type === 'player' && target.type === 'player' && attacker.pvp && target.pvp;
    }

    preventNoClip(x, y) {
        let self = this,
            isMapColliding = self.world.map.isColliding(x, y),
            isInstanceColliding = self.player.doors.hasCollision(x, y);

        if (isMapColliding || isInstanceColliding) {
            self.player.stopMovement(true);
            self.player.notify('We have detected no-clipping in your client. Please submit a bug report.');

            x = self.player.previousX < 0 ? self.player.x : self.player.previousX;
            y = self.player.previousY < 0 ? self.player.y : self.player.previousY;

            if (self.world.map.isColliding(x, y)) {
                let spawn = self.player.getSpawn();

                x = spawn.x, y = spawn.y;
            }

            self.player.teleport(x, y, false, true);


            return false;
        }

        return true;
    }

}

module.exports = Incoming;
