// Independently authored lab instrumentation for the hash-pinned official server.
// Uses only Java 8's standard instrumentation API and bundled ASM. No Vape input.
import java.io.*;
import java.net.*;
import java.lang.instrument.*;
import java.security.*;
import java.util.Random;
import jdk.internal.org.objectweb.asm.*;

public final class LabTickAgent {
    private static volatile Config config = new Config(0, 0, 421, "startup");
    private static Config active;
    private static Random rng;
    private static PrintWriter log;
    private static long previousStart, tickStart, tickNumber;
    private static int requested;
    private static final class Config {
        final int minimum, jitter; final long seed; final String label;
        Config(int minimum, int jitter, long seed, String label) {
            this.minimum = minimum; this.jitter = jitter; this.seed = seed; this.label = label;
        }
    }
    public static void premain(String args, Instrumentation instrumentation) throws Exception {
        String[] parts = args.split("\\|", 2);
        if (parts.length != 2) throw new IllegalArgumentException("port|absolute log path required");
        log = new PrintWriter(new BufferedWriter(new FileWriter(parts[1], false)));
        ServerSocket control = new ServerSocket(Integer.parseInt(parts[0]), 1, InetAddress.getByName("127.0.0.1"));
        Thread thread = new Thread(() -> {
            while (!control.isClosed()) try (Socket socket = control.accept()) {
                socket.setSoTimeout(3000);
                BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream(), "UTF-8"));
                PrintWriter out = new PrintWriter(socket.getOutputStream(), true);
                String line = in.readLine();
                String[] words = line == null ? new String[0] : line.split(" ");
                if (words.length != 4) { out.println("ERROR expected minimum jitter seed label"); continue; }
                int minimum = Integer.parseInt(words[0]), jitter = Integer.parseInt(words[1]);
                long seed = Long.parseLong(words[2]);
                if (minimum < 0 || minimum > 150 || jitter < 0 || jitter > 50 || !words[3].matches("[a-z0-9_]{1,80}")) {
                    out.println("ERROR invalid config"); continue;
                }
                config = new Config(minimum, jitter, seed, words[3]);
                out.println("OK " + words[3]);
            } catch (Exception error) { System.err.println("Lab tick control: " + error); }
        }, "localhost-lab-tick-control");
        thread.setDaemon(true); thread.start();
        Runtime.getRuntime().addShutdownHook(new Thread(() -> { synchronized (log) { log.flush(); log.close(); } }));
        instrumentation.addTransformer(new ClassFileTransformer() {
            public byte[] transform(ClassLoader loader, String name, Class<?> type, ProtectionDomain domain, byte[] bytes) {
                if (!name.equals("net/minecraft/server/MinecraftServer")) return null;
                try {
                    StringBuilder hash = new StringBuilder();
                    for (byte b : MessageDigest.getInstance("SHA-256").digest(bytes)) hash.append(String.format("%02x", b & 255));
                    if (!hash.toString().equals("4dadb11be584acde60030513aad89854992bac8811922254f27f7a4da640b5d2"))
                        throw new IllegalStateException("Unexpected official server class hash");
                    ClassReader reader = new ClassReader(bytes);
                    ClassWriter writer = new ClassWriter(reader, ClassWriter.COMPUTE_MAXS);
                    final int[] matches = { 0 };
                    reader.accept(new ClassVisitor(Opcodes.ASM5, writer) {
                        public MethodVisitor visitMethod(int access, String method, String desc, String signature, String[] exceptions) {
                            MethodVisitor original = super.visitMethod(access, method, desc, signature, exceptions);
                            if (!method.equals("A") || !desc.equals("()V")) return original;
                            matches[0]++;
                            return new MethodVisitor(Opcodes.ASM5, original) {
                                public void visitCode() {
                                    super.visitCode();
                                    super.visitMethodInsn(Opcodes.INVOKESTATIC, "LabTickAgent", "beforeTick", "()V", false);
                                }
                                public void visitInsn(int opcode) {
                                    if (opcode == Opcodes.RETURN) super.visitMethodInsn(Opcodes.INVOKESTATIC, "LabTickAgent", "afterTick", "()V", false);
                                    super.visitInsn(opcode);
                                }
                            };
                        }
                    }, 0);
                    if (matches[0] != 1) throw new IllegalStateException("Tick method not uniquely found");
                    System.out.println("FURY_LAB_TICK_INSTRUMENTATION_READY official-1.8.9");
                    return writer.toByteArray();
                } catch (Exception error) {
                    error.printStackTrace();
                    // Instrumentation errors normally fall through silently. Stop this lab JVM instead.
                    Runtime.getRuntime().halt(75); return null;
                }
            }
        });
    }
    public static void beforeTick() {
        Config next = config;
        if (active != next) { active = next; rng = new Random(active.seed); }
        requested = active.minimum + (active.jitter == 0 ? 0 : rng.nextInt(2 * active.jitter + 1) - active.jitter);
        requested = Math.max(0, requested);
        long remaining = previousStart + requested * 1000000L - System.nanoTime();
        if (remaining > 0) try { Thread.sleep(remaining / 1000000L, (int)(remaining % 1000000L)); }
        catch (InterruptedException error) { Thread.currentThread().interrupt(); }
        tickStart = System.nanoTime();
    }
    public static void afterTick() {
        long ended = System.nanoTime(), now = System.currentTimeMillis();
        double interval = previousStart == 0 ? 0 : (tickStart - previousStart) / 1000000.0;
        synchronized (log) {
            log.println("{\"t\":" + now + ",\"tick\":" + (++tickNumber) + ",\"label\":\"" + active.label
                + "\",\"requestedMinimumMs\":" + requested + ",\"intervalMs\":" + interval
                + ",\"workMs\":" + (ended - tickStart) / 1000000.0 + "}");
            if (tickNumber % 20 == 0) log.flush();
        }
        previousStart = tickStart;
    }
}
