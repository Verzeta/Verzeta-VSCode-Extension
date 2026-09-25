// SPDX-FileCopyrightText: 2026 Aditya Mehra <aix.m@outlook.com>
// SPDX-License-Identifier: LGPL-3.0-or-later

/**
 * Open-state signals for the Help, About, and Paired Devices
 * full-page overlay surfaces. Plus the extension-version signal
 * captured from the host handshake — read by AboutSheet.
 */

import { signal } from '@preact/signals';

export const aboutOpen = signal<boolean>(false);
export const helpOpen = signal<boolean>(false);
export const pairedDevicesOpen = signal<boolean>(false);

export function openAbout(): void {
    aboutOpen.value = true;
}

export function closeAbout(): void {
    aboutOpen.value = false;
}

export function openHelp(): void {
    helpOpen.value = true;
}

export function closeHelp(): void {
    helpOpen.value = false;
}

export function openPairedDevices(): void {
    pairedDevicesOpen.value = true;
}

export function closePairedDevices(): void {
    pairedDevicesOpen.value = false;
}

export const extensionVersion = signal<string>('');

export function setExtensionVersion(value: string): void {
    extensionVersion.value = value;
}
