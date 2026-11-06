package io.github.rldona.openlibrary

import io.github.rldona.openlibrary.core.CoverQuery
import io.github.rldona.openlibrary.core.OcrLine
import io.github.rldona.openlibrary.core.PixelRect
import io.github.rldona.openlibrary.core.extractCoverQuery
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CoverTextTest {
    private fun line(text: String, left: Float, top: Float, right: Float, bottom: Float) =
        OcrLine(text, PixelRect(left, top, right, bottom))

    @Test
    fun readsTheLargeTitleAndTheAuthorAboveIt() {
        val frame = PixelRect(0f, 0f, 600f, 900f)
        val lines = listOf(
            line("NASSIM NICHOLAS TALEB", 80f, 60f, 420f, 100f),
            line("¿EXISTE LA", 60f, 260f, 520f, 350f),
            line("SUERTE?", 60f, 360f, 400f, 450f),
            line("Las trampas del azar", 70f, 480f, 430f, 510f),
            line("Del autor del éxito internacional El cisne negro", 40f, 840f, 560f, 870f),
        )

        assertEquals(CoverQuery("¿EXISTE LA SUERTE?", "NASSIM NICHOLAS TALEB"), extractCoverQuery(lines, frame))
    }

    @Test
    fun acceptsAnAuthorBelowWhenItIsPrefixedWithDe() {
        val lines = listOf(
            line("La ridícula idea de no volver a verte", 40f, 100f, 500f, 180f),
            line("de Rosa Montero", 60f, 250f, 300f, 280f),
        )

        assertEquals("Rosa Montero", extractCoverQuery(lines)!!.author)
    }

    @Test
    fun doesNotTakeAnUnprefixedSubtitleBelowTheTitleAsAuthor() {
        val lines = listOf(
            line("Existe la suerte", 40f, 100f, 500f, 180f),
            line("Las trampas del azar", 60f, 250f, 400f, 280f),
        )

        assertNull(extractCoverQuery(lines)!!.author)
    }

    @Test
    fun aCoverWithOnlyProductTextHasNoQuery() {
        val lines = listOf(
            line("ISBN 978-84-376-0494-9", 40f, 100f, 500f, 130f),
            line("PVP 21,90 €", 40f, 150f, 300f, 180f),
            line("www.penguinlibros.com", 40f, 200f, 500f, 230f),
        )

        assertNull(extractCoverQuery(lines))
    }

    @Test
    fun linesWhoseCentreIsOutsideTheFrameAreIgnored() {
        val frame = PixelRect(0f, 0f, 400f, 500f)
        val lines = listOf(
            line("Rosa Montero", 50f, -30f, 300f, 0f),
            line("El nombre del viento", 20f, 20f, 380f, 120f),
        )

        assertNull(extractCoverQuery(lines, frame)!!.author)
        assertEquals("Rosa Montero", extractCoverQuery(lines)!!.author)
    }

    @Test
    fun readsANumericTitle() {
        val lines = listOf(
            line("GEORGE ORWELL", 80f, 60f, 380f, 100f),
            line("1984", 60f, 200f, 540f, 320f),
        )

        assertEquals(CoverQuery("1984", "GEORGE ORWELL"), extractCoverQuery(lines))
    }

    @Test
    fun readsTheTitleBelowAnAuthorOfTheSameSize() {
        val frame = PixelRect(0f, 0f, 920f, 1380f)
        val lines = listOf(
            line("ACANTILADO", 290f, 355f, 630f, 375f),
            line("Josep Maria Esquirol", 210f, 575f, 640f, 625f),
            line("La resistencia íntima", 230f, 650f, 650f, 700f),
            line("Ensayo de una filosofía", 260f, 710f, 620f, 735f),
        )

        assertEquals(CoverQuery("La resistencia íntima", "Josep Maria Esquirol"), extractCoverQuery(lines, frame))
    }

    @Test
    fun prefersTheTitleBelowWhenTheAuthorIsWider() {
        val lines = listOf(
            line("ROSA MONTERO", 40f, 60f, 500f, 120f),
            line("LA RIDÍCULA IDEA", 60f, 220f, 460f, 280f),
        )

        assertEquals(CoverQuery("LA RIDÍCULA IDEA", "ROSA MONTERO"), extractCoverQuery(lines))
    }

    @Test
    fun dropsASmallerSubtitleMergedWithTheTitle() {
        val lines = listOf(
            line("La resistencia íntima", 60f, 100f, 500f, 150f),
            line("Ensayo de una filosofía", 80f, 155f, 480f, 190f),
        )

        assertEquals(CoverQuery("La resistencia íntima", null), extractCoverQuery(lines))
    }

    @Test
    fun prefersTheAuthorBelowTheTitleOverTextFarAboveTheCover() {
        // Real case: a bookmark with another author's name sticks out above "Intelectos colectivos".
        val frame = PixelRect(95f, 245f, 890f, 1430f)
        val lines = listOf(
            line("Benjamín", 340f, 255f, 435f, 278f),
            line("Labatut", 345f, 283f, 432f, 305f),
            line("INTELECTOS", 240f, 630f, 720f, 695f),
            line("COLECTIVOS", 240f, 715f, 720f, 780f),
            line("Pensadores para el siglo XXI", 255f, 795f, 710f, 830f),
            line("≡ McKenzie Wark", 275f, 850f, 690f, 885f),
            line("Traducción de Javier de la Morena Corrales", 300f, 905f, 680f, 930f),
        )

        assertEquals(CoverQuery("INTELECTOS COLECTIVOS", "McKenzie Wark"), extractCoverQuery(lines, frame))
    }

    @Test
    fun aSubtitleBelowTheTitleIsNotTheAuthor() {
        val lines = listOf(
            line("INTELECTOS COLECTIVOS", 40f, 100f, 500f, 160f),
            line("Pensadores para el siglo XXI", 60f, 170f, 480f, 200f),
        )

        assertEquals(CoverQuery("INTELECTOS COLECTIVOS", null), extractCoverQuery(lines))
    }

    @Test
    fun prefersTheWiderBandWhenTwoHeightsTie() {
        val lines = listOf(
            line("ROSA MONTERO", 60f, 60f, 260f, 120f),
            line("LA RIDÍCULA IDEA", 40f, 220f, 460f, 280f),
        )

        assertEquals(CoverQuery("LA RIDÍCULA IDEA", "ROSA MONTERO"), extractCoverQuery(lines))
    }

    @Test
    fun accentsAndQuestionMarksSurviveTheBandJoin() {
        val lines = listOf(line("¿Dónde está la cigüeña?", 40f, 100f, 500f, 180f))

        assertEquals("¿Dónde está la cigüeña?", extractCoverQuery(lines)!!.title)
    }

    @Test
    fun tinyLinesAndABigBottomPromoDoNotBeatTheTitle() {
        val frame = PixelRect(0f, 0f, 600f, 1000f)
        val lines = listOf(
            line("xx", 20f, 50f, 60f, 58f),
            line("LA SOMBRA DEL VIENTO", 30f, 200f, 570f, 280f),
            line("Una novela de misterio", 40f, 330f, 560f, 360f),
            line("EL MEJOR LIBRO DEL AÑO", 30f, 850f, 570f, 895f),
        )

        assertEquals(CoverQuery("LA SOMBRA DEL VIENTO", null), extractCoverQuery(lines, frame))
    }
}
