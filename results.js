/* ============================================================================
   RESULTS — played league matches of SG Heilbronn/Leingarten IV
   Bezirksliga „Neckar-Odenwald" (3-4) 2026/27
   ----------------------------------------------------------------------------
   Rewritten by scripts/update-results.mjs (GitHub Action "Update results",
   Sunday + Monday morning after each match day). Keys are the match ids of
   the Termine schedule in app.js (yyyy-mm-dd-HHMM); own/opp = games from our
   side, report = link to the nuLiga match report. Unplayed matches are absent.
   The Termine tab shows each entry as a coloured pill next to Heim/Auswärts.

   Source:
   https://bwbv-badminton.liga.nu/cgi-bin/WebObjects/nuLigaBADDE.woa/wa/groupPage?championship=NB+26%2F27&group=40186
   ========================================================================== */
window.RESULTS = {
  "2026-11-14-1400": { own: 4, opp: 4, report: "https://bwbv-badminton.liga.nu/cgi-bin/WebObjects/nuLigaBADDE.woa/wa/groupMeetingReport?meeting=398229&championship=NB+26%2F27&group=40186" },
  "2026-11-14-1800": { own: 6, opp: 2, report: "https://bwbv-badminton.liga.nu/cgi-bin/WebObjects/nuLigaBADDE.woa/wa/groupMeetingReport?meeting=398227&championship=NB+26%2F27&group=40186" },
};
