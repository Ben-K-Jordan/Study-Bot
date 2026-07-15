export default function SessionNotFound() {
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "2rem 1rem", fontFamily: "var(--font-body)", color: "var(--color-text)" }}>
      <h1>Session Not Found</h1>
      <p>This session does not exist or you do not have access to it.</p>
    </main>
  );
}
