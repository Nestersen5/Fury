"""Dependency-free, focus-checked Windows input and PNG screenshot helper.

JSON lines on stdin; JSON lines on stdout. Never synthesizes input unless the
foreground window belongs to the explicitly supplied Java client PID.
"""
import argparse
import ctypes as C
import json
import os
import struct
import sys
import time
import zlib
from ctypes import wintypes as W

user32 = C.WinDLL('user32', use_last_error=True)
gdi32 = C.WinDLL('gdi32', use_last_error=True)
PTR = C.c_ulonglong if C.sizeof(C.c_void_p) == 8 else C.c_ulong


class MOUSEINPUT(C.Structure):
    _fields_ = [('dx', W.LONG), ('dy', W.LONG), ('mouseData', W.DWORD),
                ('dwFlags', W.DWORD), ('time', W.DWORD), ('dwExtraInfo', PTR)]


class KEYBDINPUT(C.Structure):
    _fields_ = [('wVk', W.WORD), ('wScan', W.WORD), ('dwFlags', W.DWORD),
                ('time', W.DWORD), ('dwExtraInfo', PTR)]


class HARDWAREINPUT(C.Structure):
    _fields_ = [('uMsg', W.DWORD), ('wParamL', W.WORD), ('wParamH', W.WORD)]


class INPUT_UNION(C.Union):
    _fields_ = [('mi', MOUSEINPUT), ('ki', KEYBDINPUT), ('hi', HARDWAREINPUT)]


class INPUT(C.Structure):
    _fields_ = [('type', W.DWORD), ('u', INPUT_UNION)]


class BITMAPINFOHEADER(C.Structure):
    _fields_ = [('biSize', W.DWORD), ('biWidth', W.LONG), ('biHeight', W.LONG),
                ('biPlanes', W.WORD), ('biBitCount', W.WORD), ('biCompression', W.DWORD),
                ('biSizeImage', W.DWORD), ('biXPelsPerMeter', W.LONG),
                ('biYPelsPerMeter', W.LONG), ('biClrUsed', W.DWORD), ('biClrImportant', W.DWORD)]


class BITMAPINFO(C.Structure):
    _fields_ = [('bmiHeader', BITMAPINFOHEADER), ('bmiColors', W.DWORD * 3)]


user32.EnumWindows.argtypes = [C.c_void_p, W.LPARAM]
user32.GetWindowThreadProcessId.argtypes = [W.HWND, C.POINTER(W.DWORD)]
user32.GetForegroundWindow.restype = W.HWND
user32.GetWindowRect.argtypes = [W.HWND, C.POINTER(W.RECT)]
user32.GetWindowTextLengthW.argtypes = [W.HWND]
user32.GetWindowTextW.argtypes = [W.HWND, W.LPWSTR, C.c_int]
user32.SendInput.argtypes = [W.UINT, C.POINTER(INPUT), C.c_int]
user32.SendInput.restype = W.UINT
user32.SetCursorPos.argtypes = [C.c_int, C.c_int]
user32.GetDC.argtypes = [W.HWND]
user32.GetDC.restype = W.HDC
gdi32.CreateCompatibleDC.argtypes = [W.HDC]
gdi32.CreateCompatibleDC.restype = W.HDC
gdi32.CreateCompatibleBitmap.argtypes = [W.HDC, C.c_int, C.c_int]
gdi32.CreateCompatibleBitmap.restype = W.HBITMAP
gdi32.SelectObject.argtypes = [W.HDC, W.HGDIOBJ]
gdi32.SelectObject.restype = W.HGDIOBJ
gdi32.BitBlt.argtypes = [W.HDC, C.c_int, C.c_int, C.c_int, C.c_int, W.HDC, C.c_int, C.c_int, W.DWORD]
gdi32.GetDIBits.argtypes = [W.HDC, W.HBITMAP, W.UINT, W.UINT, C.c_void_p, C.POINTER(BITMAPINFO), W.UINT]
gdi32.DeleteObject.argtypes = [W.HGDIOBJ]
gdi32.DeleteDC.argtypes = [W.HDC]
user32.ReleaseDC.argtypes = [W.HWND, W.HDC]


def window_for(pid):
    found = []

    @C.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)
    def visit(hwnd, _):
        owner = W.DWORD()
        user32.GetWindowThreadProcessId(hwnd, C.byref(owner))
        if owner.value != pid or not user32.IsWindowVisible(hwnd):
            return True
        size = user32.GetWindowTextLengthW(hwnd)
        title = C.create_unicode_buffer(size + 1)
        user32.GetWindowTextW(hwnd, title, size + 1)
        rect = W.RECT()
        user32.GetWindowRect(hwnd, C.byref(rect))
        if rect.right - rect.left >= 400 and rect.bottom - rect.top >= 300:
            found.append((hwnd, title.value, rect))
        return True

    user32.EnumWindows(visit, 0)
    if not found:
        raise RuntimeError('No visible Minecraft-sized window for client PID')
    found.sort(key=lambda item: ('Minecraft' not in item[1], -((item[2].right-item[2].left)*(item[2].bottom-item[2].top))))
    return found[0]


def check_focus(pid):
    hwnd, title, rect = window_for(pid)
    if user32.GetForegroundWindow() != hwnd:
        raise RuntimeError('Minecraft window lost focus; input aborted')
    return hwnd, title, rect


def send(item):
    if user32.SendInput(1, C.byref(item), C.sizeof(INPUT)) != 1:
        raise OSError(C.get_last_error(), 'SendInput failed')


def key(vk, down):
    item = INPUT()
    item.type = 1
    item.u.ki = KEYBDINPUT(vk, 0, 0 if down else 2, 0, 0)
    send(item)


def mouse(button, down):
    flags = {'left': (0x0002, 0x0004), 'right': (0x0008, 0x0010)}[button]
    item = INPUT()
    item.type = 0
    item.u.mi = MOUSEINPUT(0, 0, 0, flags[0 if down else 1], 0, 0)
    send(item)


def move(dx, dy):
    item = INPUT()
    item.type = 0
    item.u.mi = MOUSEINPUT(int(dx), int(dy), 0, 0x0001, 0, 0)
    send(item)


def respawn_click(rect):
    """Click the 1.8.9 death-screen Respawn button, if it is present."""
    x = (rect.left + rect.right) // 2
    y = (rect.top + rect.bottom) // 2 + 40
    if not user32.SetCursorPos(x, y):
        raise OSError(C.get_last_error(), 'SetCursorPos failed')
    mouse('left', True)
    time.sleep(0.08)
    mouse('left', False)


def png_chunk(tag, data):
    return struct.pack('!I', len(data)) + tag + data + struct.pack('!I', zlib.crc32(tag + data) & 0xffffffff)


def screenshot(rect, target):
    width, height = rect.right - rect.left, rect.bottom - rect.top
    if not (400 <= width <= 4096 and 300 <= height <= 2160):
        raise RuntimeError('Unsafe screenshot dimensions')
    screen = user32.GetDC(0)
    mem = gdi32.CreateCompatibleDC(screen)
    bitmap = gdi32.CreateCompatibleBitmap(screen, width, height)
    old = gdi32.SelectObject(mem, bitmap)
    try:
        if not gdi32.BitBlt(mem, 0, 0, width, height, screen, rect.left, rect.top, 0x00CC0020):
            raise OSError(C.get_last_error(), 'BitBlt failed')
        info = BITMAPINFO()
        info.bmiHeader = BITMAPINFOHEADER(C.sizeof(BITMAPINFOHEADER), width, -height, 1, 32, 0, width*height*4, 0, 0, 0, 0)
        pixels = C.create_string_buffer(width*height*4)
        if gdi32.GetDIBits(mem, bitmap, 0, height, pixels, C.byref(info), 0) != height:
            raise OSError(C.get_last_error(), 'GetDIBits failed')
        raw = bytearray()
        data = memoryview(pixels.raw)
        for row in range(height):
            raw.append(0)
            offset = row*width*4
            for col in range(width):
                b, g, r, _ = data[offset+col*4:offset+col*4+4]
                raw.extend((r, g, b))
        encoded = b'\x89PNG\r\n\x1a\n'
        encoded += png_chunk(b'IHDR', struct.pack('!2I5B', width, height, 8, 2, 0, 0, 0))
        encoded += png_chunk(b'IDAT', zlib.compress(bytes(raw), 6))
        encoded += png_chunk(b'IEND', b'')
        with open(target, 'xb') as handle:
            handle.write(encoded)
    finally:
        gdi32.SelectObject(mem, old)
        gdi32.DeleteObject(bitmap)
        gdi32.DeleteDC(mem)
        user32.ReleaseDC(0, screen)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pid', type=int, required=True)
    args = parser.parse_args()
    for line in sys.stdin:
        request = json.loads(line)
        command = request['command']
        result = {'id': request.get('id'), 't': int(time.time()*1000), 'command': command}
        try:
            if command == 'find':
                hwnd, title, rect = window_for(args.pid)
                result.update(hwnd=int(hwnd), title=title, foreground=user32.GetForegroundWindow() == hwnd)
            elif command == 'focus':
                hwnd, title, rect = window_for(args.pid)
                user32.ShowWindow(hwnd, 9)
                user32.SetForegroundWindow(hwnd)
                check_focus(args.pid)
                result.update(hwnd=int(hwnd), title=title)
            else:
                _, _, rect = check_focus(args.pid)
                if command == 'key':
                    key(int(request['vk']), bool(request['down']))
                elif command == 'mouse':
                    mouse(request['button'], bool(request['down']))
                elif command == 'move':
                    move(request['dx'], request['dy'])
                elif command == 'respawn_click':
                    respawn_click(rect)
                elif command == 'shot':
                    target = os.path.abspath(request['path'])
                    screenshot(rect, target)
                    result['path'] = target
                elif command != 'check':
                    raise ValueError('Unknown command')
            result['ok'] = True
        except Exception as exc:
            result.update(ok=False, error=str(exc))
        print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
