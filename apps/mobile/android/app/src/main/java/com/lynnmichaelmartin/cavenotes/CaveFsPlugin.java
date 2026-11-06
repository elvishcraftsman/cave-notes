package com.lynnmichaelmartin.cavenotes;

import android.content.Intent;
import android.net.Uri;
import android.os.Environment;
import android.provider.Settings;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AccessDeniedException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.DirectoryNotEmptyException;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.NotDirectoryException;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.nio.file.FileVisitResult;
import java.nio.file.FileVisitOption;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.EnumSet;
import java.util.UUID;

/**
 * Real-path file access for Cave Notes: the notes folder is an ordinary folder that Syncthing also syncs.
 * Needs "All files access" (MANAGE_EXTERNAL_STORAGE), which the user grants on a system screen.
 *
 * These are single, simple operations. Everything with a rule in it (flags, recursion, which error for which situation) lives in
 * src/pluginFs.ts, where it is tested; here a failure only has to say which POSIX error it was (ENOENT, EEXIST, ENOTDIR,
 * ENOTEMPTY, EACCES, EIO) in the rejection's code.
 * Plugin methods run on Capacitor's own plugin thread, not the UI thread, so plain blocking I/O is fine here.
 */
@CapacitorPlugin(name = "CaveFs")
public class CaveFsPlugin extends Plugin {
    /** A single read is for notes and pictures; refuse to pull a huge file into the WebView by mistake. */
    private static final long MAX_READ_BYTES = 64L * 1024 * 1024;

    private static String codeOf(Exception e) {
        if (e instanceof NoSuchFileException) return "ENOENT";
        if (e instanceof FileAlreadyExistsException) return "EEXIST";
        if (e instanceof DirectoryNotEmptyException) return "ENOTEMPTY";
        if (e instanceof NotDirectoryException) return "ENOTDIR";
        if (e instanceof AccessDeniedException) return "EACCES";
        if (e instanceof java.io.FileNotFoundException) {
            String m = String.valueOf(e.getMessage());
            if (m.contains("EACCES") || m.contains("Permission denied")) return "EACCES";
            if (m.contains("EISDIR") || m.contains("Is a directory")) return "EISDIR";
            if (m.contains("ENOTDIR")) return "ENOTDIR";
            return "ENOENT";
        }
        return "EIO";
    }

    private static void fail(PluginCall call, Exception e) {
        call.reject(String.valueOf(e.getMessage()), codeOf(e), e);
    }

    private static String need(PluginCall call, String key) {
        String v = call.getString(key);
        if (v == null) call.reject(key + " is required", "EIO");
        return v;
    }

    @PluginMethod
    public void hasAccess(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", Environment.isExternalStorageManager());
        call.resolve(r);
    }

    @PluginMethod
    public void requestAccess(PluginCall call) {
        try {
            Intent intent = new Intent(
                Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                Uri.parse("package:" + getContext().getPackageName())
            );
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        } catch (RuntimeException e) {
            Intent fallback = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
            fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(fallback);
        }
        call.resolve();
    }

    @PluginMethod
    public void list(PluginCall call) {
        String path = need(call, "path");
        if (path == null) return;
        File dir = new File(path);
        if (!dir.exists()) {
            call.reject("no such file or directory: " + path, "ENOENT");
            return;
        }
        if (!dir.isDirectory()) {
            call.reject("not a directory: " + path, "ENOTDIR");
            return;
        }
        File[] children = dir.listFiles();
        if (children == null) {
            call.reject("cannot list " + path + " (is All files access granted?)", "EACCES");
            return;
        }
        JSArray entries = new JSArray();
        for (File f : children) {
            JSObject e = new JSObject();
            e.put("name", f.getName());
            e.put("isDir", f.isDirectory());
            e.put("size", f.length());
            e.put("mtime", f.lastModified());
            entries.put(e);
        }
        JSObject r = new JSObject();
        r.put("entries", entries);
        call.resolve(r);
    }

    /**
     * Everything under a folder in one call: the whole listing that indexing would otherwise ask for folder by folder (a call
     * across the bridge each). One line per entry in `data`: kind (d or f), size, modified time (ms), and the path below the folder,
     * separated by | (a name may hold any other character, and never a newline). Links are not followed.
     */
    @PluginMethod
    public void tree(PluginCall call) {
        final String path = need(call, "path");
        if (path == null) return;
        final java.nio.file.Path root = new File(path).toPath();
        if (!Files.isDirectory(root)) {
            call.reject("not a directory: " + path, Files.exists(root) ? "ENOTDIR" : "ENOENT");
            return;
        }
        final StringBuilder out = new StringBuilder();
        final int[] count = {0};
        final boolean[] truncated = {false};
        final int limit = call.getInt("limit", 300000);
        try {
            Files.walkFileTree(
                root,
                EnumSet.noneOf(FileVisitOption.class),
                Integer.MAX_VALUE,
                new SimpleFileVisitor<java.nio.file.Path>() {
                    private FileVisitResult add(java.nio.file.Path p, BasicFileAttributes a, boolean dir) {
                        if (count[0] >= limit) {
                            truncated[0] = true;
                            return FileVisitResult.TERMINATE;
                        }
                        count[0]++;
                        out.append(dir ? 'd' : 'f').append('|').append(dir ? 0 : a.size()).append('|').append(a.lastModifiedTime().toMillis()).append('|').append(root.relativize(p).toString()).append('\n');
                        return FileVisitResult.CONTINUE;
                    }

                    @Override
                    public FileVisitResult preVisitDirectory(java.nio.file.Path dir, BasicFileAttributes a) {
                        return dir.equals(root) ? FileVisitResult.CONTINUE : add(dir, a, true);
                    }

                    @Override
                    public FileVisitResult visitFile(java.nio.file.Path file, BasicFileAttributes a) {
                        return add(file, a, false);
                    }

                    @Override
                    public FileVisitResult visitFileFailed(java.nio.file.Path file, IOException e) {
                        return FileVisitResult.CONTINUE;
                    }
                }
            );
        } catch (IOException e) {
            fail(call, e);
            return;
        }
        JSObject r = new JSObject();
        r.put("data", out.toString());
        r.put("count", count[0]);
        r.put("truncated", truncated[0]);
        call.resolve(r);
    }

    @PluginMethod
    public void read(PluginCall call) {
        String path = need(call, "path");
        if (path == null) return;
        try {
            File f = new File(path);
            if (f.length() > MAX_READ_BYTES) {
                call.reject("file is too large to open: " + f.length() + " bytes", "EIO");
                return;
            }
            byte[] bytes = Files.readAllBytes(f.toPath());
            JSObject r = new JSObject();
            r.put("text", new String(bytes, StandardCharsets.UTF_8));
            r.put("size", bytes.length);
            r.put("mtime", f.lastModified());
            call.resolve(r);
        } catch (IOException e) {
            fail(call, e);
        }
    }

    @PluginMethod
    public void readBase64(PluginCall call) {
        String path = need(call, "path");
        if (path == null) return;
        try {
            File f = new File(path);
            if (f.length() > MAX_READ_BYTES) {
                call.reject("file is too large to open: " + f.length() + " bytes", "EIO");
                return;
            }
            byte[] bytes = Files.readAllBytes(f.toPath());
            JSObject r = new JSObject();
            r.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
            r.put("size", bytes.length);
            r.put("mtime", f.lastModified());
            call.resolve(r);
        } catch (IOException e) {
            fail(call, e);
        }
    }

    /** Writes to a temporary file beside the target, flushes it to storage, then renames it over the target. */
    private static void replaceFile(File target, byte[] bytes) throws IOException {
        File dir = target.getParentFile();
        File tmp = new File(dir, "." + target.getName() + "." + UUID.randomUUID().toString().substring(0, 8) + ".cave-tmp");
        try {
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(bytes);
                out.getFD().sync();
            }
            try {
                Files.move(tmp.toPath(), target.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(tmp.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            tmp.delete();
            throw e;
        }
    }

    private static JSObject sizeAndTime(File f, long size) {
        JSObject r = new JSObject();
        r.put("size", size);
        r.put("mtime", f.lastModified());
        return r;
    }

    @PluginMethod
    public void write(PluginCall call) {
        String path = need(call, "path");
        String text = call.getString("text");
        if (path == null) return;
        if (text == null) {
            call.reject("text is required", "EIO");
            return;
        }
        try {
            byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
            File target = new File(path);
            replaceFile(target, bytes);
            call.resolve(sizeAndTime(target, bytes.length));
        } catch (IOException e) {
            fail(call, e);
        }
    }

    /** flag: "w" replace (temporary file, then rename), "wx" fail with EEXIST if the file is there, "a" append. */
    @PluginMethod
    public void writeBase64(PluginCall call) {
        String path = need(call, "path");
        String data = call.getString("data");
        String flag = call.getString("flag", "w");
        if (path == null) return;
        if (data == null) {
            call.reject("data is required", "EIO");
            return;
        }
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            File target = new File(path);
            if ("wx".equals(flag)) {
                Files.write(target.toPath(), bytes, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
            } else if ("a".equals(flag)) {
                Files.write(target.toPath(), bytes, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
            } else {
                replaceFile(target, bytes);
            }
            call.resolve(sizeAndTime(target, target.length()));
        } catch (IOException e) {
            fail(call, e);
        }
    }

    @PluginMethod
    public void stat(PluginCall call) {
        String path = need(call, "path");
        if (path == null) return;
        File f = new File(path);
        JSObject r = new JSObject();
        r.put("exists", f.exists());
        r.put("isDir", f.isDirectory());
        r.put("size", f.length());
        r.put("mtime", f.lastModified());
        call.resolve(r);
    }

    @PluginMethod
    public void mkdir(PluginCall call) {
        String path = need(call, "path");
        if (path == null) return;
        boolean recursive = Boolean.TRUE.equals(call.getBoolean("recursive", false));
        File dir = new File(path);
        if (recursive) {
            if (dir.isDirectory() || dir.mkdirs()) call.resolve();
            else call.reject("could not create folder: " + path, dir.exists() ? "ENOTDIR" : "EACCES");
            return;
        }
        if (dir.exists()) {
            call.reject("file already exists: " + path, "EEXIST");
        } else if (dir.mkdir()) {
            call.resolve();
        } else {
            File parent = dir.getParentFile();
            call.reject("could not create folder: " + path, parent == null || !parent.exists() ? "ENOENT" : "EACCES");
        }
    }

    @PluginMethod
    public void rename(PluginCall call) {
        String from = need(call, "from");
        String to = need(call, "to");
        if (from == null || to == null) return;
        try {
            try {
                Files.move(new File(from).toPath(), new File(to).toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(new File(from).toPath(), new File(to).toPath(), StandardCopyOption.REPLACE_EXISTING);
            }
            call.resolve();
        } catch (IOException e) {
            fail(call, e);
        }
    }

    /** Deletes a file or an empty folder. */
    @PluginMethod
    public void remove(PluginCall call) {
        String path = need(call, "path");
        if (path == null) return;
        try {
            Files.delete(new File(path).toPath());
            call.resolve();
        } catch (IOException e) {
            fail(call, e);
        }
    }

    @PluginMethod
    public void copyFile(PluginCall call) {
        String from = need(call, "from");
        String to = need(call, "to");
        if (from == null || to == null) return;
        boolean exclusive = Boolean.TRUE.equals(call.getBoolean("exclusive", false));
        try {
            if (exclusive) Files.copy(new File(from).toPath(), new File(to).toPath());
            else Files.copy(new File(from).toPath(), new File(to).toPath(), StandardCopyOption.REPLACE_EXISTING);
            call.resolve();
        } catch (IOException e) {
            fail(call, e);
        }
    }

    @PluginMethod
    public void appPaths(PluginCall call) {
        JSObject r = new JSObject();
        r.put("files", getContext().getFilesDir().getAbsolutePath());
        r.put("cache", getContext().getCacheDir().getAbsolutePath());
        call.resolve(r);
    }

    @PluginMethod
    public void realpath(PluginCall call) {
        String path = need(call, "path");
        if (path == null) return;
        try {
            JSObject r = new JSObject();
            r.put("path", new File(path).getCanonicalPath());
            call.resolve(r);
        } catch (IOException e) {
            fail(call, e);
        }
    }
}
