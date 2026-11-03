# Codes de sortie de manage.sh (source unique : libellés + constantes).
#
# 64-78 = plage sysexits.h (convention POSIX) : 0-63 restent les erreurs shell
# génériques, 126/127 sont réservés par le shell et 128+n signifie « tué par le
# signal n ». Un code custom hors de ces plages est donc à éviter.
#
# Usage : . scripts/exit-codes.sh  puis  die_code "$EXIT_USAGE" "message"

EXIT_OK=0
EXIT_ERROR=1
EXIT_USAGE=64
EXIT_NOINPUT=66
EXIT_UNAVAILABLE=69
EXIT_SOFTWARE=70
EXIT_DATAERR=71
EXIT_TEMPFAIL=75
EXIT_CONFIG=78

# Liste des codes, dans l'ordre d'affichage (utilisée par 'manage.sh codes' et les tests).
EXIT_CODES="0 1 64 66 69 70 71 75 78"

exit_code_label() {
  case "$1" in
    0)  echo "OK" ;;
    1)  echo "erreur générique" ;;
    64) echo "usage : commande ou option inconnue" ;;
    66) echo "entrée invalide : fichier manquant ou illisible" ;;
    69) echo "indisponible : outil absent ou réseau coupé" ;;
    70) echo "erreur interne : le script a échoué" ;;
    71) echo "données invalides : version ou fichier incohérent" ;;
    75) echo "temporaire : réessayer plus tard (réseau)" ;;
    78) echo "configuration invalide" ;;
    *)  echo "code inconnu" ;;
  esac
}
